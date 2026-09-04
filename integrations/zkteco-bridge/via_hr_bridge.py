"""Durable, outbound-only delivery of ZKTeco punches to VIA HR.

The terminal COMKey and fingerprint templates never leave the office network.
Only terminal identity, punch time, status and method are transmitted. Delivery
is idempotent: every punch gets a deterministic SHA-256 event identifier and
VIA HR enforces uniqueness in PostgreSQL.
"""

import hashlib
import hmac
import json
import os
import time
import urllib.error
import urllib.request
from datetime import datetime
from zoneinfo import ZoneInfo

import db


def _settings():
    base_url = os.getenv("VIA_HR_URL", "").strip().rstrip("/")
    secret = os.getenv("VIA_HR_DEVICE_SECRET", "").strip()
    if not base_url and not secret:
        return None
    if not base_url.startswith("https://"):
        raise RuntimeError("VIA_HR_URL must use HTTPS")
    if len(secret) < 32:
        raise RuntimeError("VIA_HR_DEVICE_SECRET must contain at least 32 characters")
    return base_url, secret


def ensure_delivery_schema():
    with db._connect() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS via_hr_deliveries (
                punch_id INTEGER PRIMARY KEY REFERENCES punches(id) ON DELETE CASCADE,
                status TEXT NOT NULL DEFAULT 'pending'
                    CHECK(status IN ('pending','delivered')),
                attempts INTEGER NOT NULL DEFAULT 0,
                next_attempt_at INTEGER NOT NULL DEFAULT 0,
                delivered_at TEXT,
                last_error TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_via_hr_deliveries_pending
                ON via_hr_deliveries(status, next_attempt_at, punch_id);
            CREATE TABLE IF NOT EXISTS via_hr_device_users (
                device_id TEXT NOT NULL,
                device_user_id TEXT NOT NULL,
                device_user_name TEXT,
                last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
                PRIMARY KEY (device_id, device_user_id)
            );
            INSERT OR IGNORE INTO via_hr_deliveries (punch_id)
                SELECT id FROM punches WHERE source = 'poll';
            """
        )
        conn.commit()


def cache_device_users(device_id, device_users):
    """Cache terminal names without exporting credentials or biometric templates."""
    ensure_delivery_schema()
    rows = []
    for user in device_users:
        user_id = str(getattr(user, "user_id", "")).strip()
        if not user_id:
            continue
        name = str(getattr(user, "name", "") or "").strip()[:160] or None
        rows.append((str(device_id), user_id, name))
    if not rows:
        return
    with db._connect() as conn:
        conn.executemany(
            "INSERT INTO via_hr_device_users (device_id, device_user_id, device_user_name) "
            "VALUES (?, ?, ?) ON CONFLICT(device_id, device_user_id) DO UPDATE SET "
            "device_user_name=excluded.device_user_name, last_seen_at=datetime('now')",
            rows,
        )
        conn.commit()


def queue_punch_ids(punch_ids):
    if not punch_ids:
        return
    ensure_delivery_schema()
    with db._connect() as conn:
        conn.executemany(
            "INSERT OR IGNORE INTO via_hr_deliveries (punch_id) VALUES (?)",
            [(int(punch_id),) for punch_id in punch_ids],
        )
        conn.commit()


def _event_id(device_id, row):
    material = "|".join(
        [
            str(device_id),
            str(row["device_user_id"]),
            str(row["ts"]),
            str(row["status"] if row["status"] is not None else ""),
            str(row["punch_method"] if row["punch_method"] is not None else ""),
        ]
    )
    return hashlib.sha256(material.encode("utf-8")).hexdigest()


def _utc_timestamp(value, timezone):
    parsed = datetime.strptime(value, "%Y-%m-%d %H:%M:%S")
    return parsed.replace(tzinfo=ZoneInfo(timezone)).astimezone(ZoneInfo("UTC")).isoformat()


def _pending(device_id, limit):
    now = int(time.time())
    return db.query(
        "SELECT p.*, d.attempts, u.device_user_name FROM punches p "
        "JOIN via_hr_deliveries d ON d.punch_id=p.id "
        "LEFT JOIN via_hr_device_users u ON u.device_id=p.device_id "
        "AND u.device_user_id=p.device_user_id "
        "WHERE p.device_id=? AND d.status='pending' AND d.next_attempt_at<=? "
        "ORDER BY p.ts, p.id LIMIT ?",
        (device_id, now, limit),
    )


def _mark_delivered(rows):
    with db._connect() as conn:
        conn.executemany(
            "UPDATE via_hr_deliveries SET status='delivered', delivered_at=datetime('now'), "
            "attempts=attempts+1, last_error=NULL WHERE punch_id=?",
            [(row["id"],) for row in rows],
        )
        conn.commit()


def _mark_failed(rows, error):
    safe_error = str(error)[:500]
    with db._connect() as conn:
        for row in rows:
            attempts = int(row["attempts"] or 0) + 1
            delay = min(3600, max(30, 30 * (2 ** min(attempts, 7))))
            conn.execute(
                "UPDATE via_hr_deliveries SET attempts=?, next_attempt_at=?, last_error=? "
                "WHERE punch_id=?",
                (attempts, int(time.time()) + delay, safe_error, row["id"]),
            )
        conn.commit()


def deliver_pending(device_cfg, timezone, device_info=None, batch_size=500):
    try:
        settings = _settings()
    except RuntimeError as exc:
        return 0, str(exc)
    if settings is None:
        return 0, None
    ensure_delivery_schema()
    rows = _pending(device_cfg.id, max(1, min(int(batch_size), 500)))
    if not rows:
        return 0, None
    base_url, secret = settings
    payload = {
        "punches": [
            {
                "externalEventId": _event_id(device_cfg.id, row),
                "deviceUserId": str(row["device_user_id"]),
                **(
                    {"deviceUserName": str(row["device_user_name"])}
                    if row["device_user_name"]
                    else {}
                ),
                "occurredAt": _utc_timestamp(row["ts"], timezone),
                "status": row["status"],
                "punchMethod": row["punch_method"],
            }
            for row in rows
        ]
    }
    if device_info:
        if device_info.get("serial"):
            payload["serialNumber"] = str(device_info["serial"])
        if device_info.get("platform"):
            payload["model"] = str(device_info["platform"])
    body = json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8")
    timestamp = str(int(time.time()))
    signature = hmac.new(
        secret.encode("utf-8"), timestamp.encode("ascii") + b"." + body, hashlib.sha256
    ).hexdigest()
    request = urllib.request.Request(
        base_url + "/api/integrations/zkteco/punches",
        data=body,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "Accept": "application/json",
            "X-VIA-Device-ID": device_cfg.id,
            "X-VIA-Timestamp": timestamp,
            "X-VIA-Signature": "sha256=" + signature,
            "User-Agent": "VIA-ZKTeco-Bridge/1.0",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            result = json.loads(response.read().decode("utf-8"))
            accounted_for = sum(
                int(result.get(key, 0))
                for key in ("accepted", "duplicates", "unmatched", "rejected")
            )
            if accounted_for != len(rows):
                raise RuntimeError("VIA HR did not acknowledge every punch in the batch")
        _mark_delivered(rows)
        return len(rows), None
    except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, ValueError, RuntimeError) as exc:
        _mark_failed(rows, exc)
        return 0, str(exc)
