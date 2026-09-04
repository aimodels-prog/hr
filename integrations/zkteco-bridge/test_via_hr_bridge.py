import hashlib
import hmac
import importlib.util
import json
import os
import sqlite3
import sys
import tempfile
import types
import unittest
import urllib.error
from pathlib import Path
from unittest import mock


class _Response:
    def __init__(self, payload):
        self.payload = payload

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def read(self):
        return json.dumps(self.payload).encode("utf-8")


class BridgeDeliveryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.database_path = os.path.join(self.temp.name, "collector.db")
        self.db = types.ModuleType("db")

        def connect():
            connection = sqlite3.connect(self.database_path)
            connection.row_factory = sqlite3.Row
            return connection

        def query(statement, params=()):
            with connect() as connection:
                return connection.execute(statement, params).fetchall()

        self.db._connect = connect
        self.db.query = query
        sys.modules["db"] = self.db
        with connect() as connection:
            connection.execute(
                "CREATE TABLE punches (id INTEGER PRIMARY KEY, device_id TEXT NOT NULL, "
                "device_user_id TEXT NOT NULL, ts TEXT NOT NULL, status INTEGER, "
                "punch_method INTEGER, source TEXT NOT NULL)"
            )
            connection.execute(
                "INSERT INTO punches VALUES (1, 'front-door', 'VIA-101', "
                "'2026-09-04 08:00:00', 0, 1, 'poll')"
            )
        module_path = Path(__file__).with_name("via_hr_bridge.py")
        spec = importlib.util.spec_from_file_location("via_hr_bridge_under_test", module_path)
        self.bridge = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.bridge)
        self.device = types.SimpleNamespace(id="front-door")
        self.secret = "zkteco-test-secret-with-more-than-32-characters"
        self.environment = mock.patch.dict(
            os.environ,
            {"VIA_HR_URL": "https://hr.via-int.com", "VIA_HR_DEVICE_SECRET": self.secret},
        )
        self.environment.start()

    def tearDown(self):
        self.environment.stop()
        sys.modules.pop("db", None)
        self.temp.cleanup()

    def test_signed_delivery_is_durable_and_idempotent(self):
        self.bridge.cache_device_users(
            "front-door",
            [types.SimpleNamespace(user_id="VIA-101", name="Ahmed Hassan")],
        )
        self.bridge.queue_punch_ids([1])
        captured = {}

        def urlopen(request, timeout):
            captured["request"] = request
            captured["timeout"] = timeout
            return _Response({"accepted": 1, "duplicates": 0, "unmatched": 0, "rejected": 0})

        with mock.patch.object(self.bridge.urllib.request, "urlopen", side_effect=urlopen):
            delivered, error = self.bridge.deliver_pending(self.device, "Asia/Muscat")
        self.assertEqual((delivered, error), (1, None))
        request = captured["request"]
        headers = {key.lower(): value for key, value in request.header_items()}
        timestamp = headers["x-via-timestamp"]
        expected = hmac.new(
            self.secret.encode("utf-8"),
            timestamp.encode("ascii") + b"." + request.data,
            hashlib.sha256,
        ).hexdigest()
        self.assertEqual(headers["x-via-signature"], "sha256=" + expected)
        self.assertEqual(headers["x-via-device-id"], "front-door")
        self.assertEqual(captured["timeout"], 30)
        [sent_punch] = json.loads(request.data.decode("utf-8"))["punches"]
        self.assertEqual(sent_punch["deviceUserName"], "Ahmed Hassan")
        [delivery] = self.db.query("SELECT status, attempts FROM via_hr_deliveries")
        self.assertEqual((delivery["status"], delivery["attempts"]), ("delivered", 1))

        with mock.patch.object(self.bridge.urllib.request, "urlopen") as second_send:
            self.assertEqual(
                self.bridge.deliver_pending(self.device, "Asia/Muscat"),
                (0, None),
            )
        second_send.assert_not_called()

    def test_blank_terminal_name_is_not_sent(self):
        self.bridge.cache_device_users(
            "front-door",
            [types.SimpleNamespace(user_id="VIA-101", name="   ")],
        )
        self.bridge.queue_punch_ids([1])
        captured = {}

        def urlopen(request, timeout):
            captured["request"] = request
            return _Response({"accepted": 1, "duplicates": 0, "unmatched": 0, "rejected": 0})

        with mock.patch.object(self.bridge.urllib.request, "urlopen", side_effect=urlopen):
            self.assertEqual(self.bridge.deliver_pending(self.device, "Asia/Muscat"), (1, None))
        [sent_punch] = json.loads(captured["request"].data.decode("utf-8"))["punches"]
        self.assertNotIn("deviceUserName", sent_punch)

    def test_failed_delivery_remains_queued_for_retry(self):
        self.bridge.queue_punch_ids([1])
        with mock.patch.object(
            self.bridge.urllib.request,
            "urlopen",
            side_effect=urllib.error.URLError("offline"),
        ):
            delivered, error = self.bridge.deliver_pending(self.device, "Asia/Muscat")
        self.assertEqual(delivered, 0)
        self.assertIn("offline", error)
        [delivery] = self.db.query(
            "SELECT status, attempts, next_attempt_at, last_error FROM via_hr_deliveries"
        )
        self.assertEqual(delivery["status"], "pending")
        self.assertEqual(delivery["attempts"], 1)
        self.assertGreater(delivery["next_attempt_at"], 0)
        self.assertIn("offline", delivery["last_error"])


if __name__ == "__main__":
    unittest.main()
