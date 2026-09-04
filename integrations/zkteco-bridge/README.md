# ZKTeco office bridge

This module is copied into the office-only `ZKTeco-BioTime` collector. The collector reads the
terminal over LAN port 4370 and sends only punch evidence to VIA HR over outbound HTTPS.

Required NAS/container environment values:

```text
VIA_HR_URL=https://hr.via-int.com
VIA_HR_DEVICE_SECRET=<same dedicated 32+ character secret as VIA_HR_ZKTECO_INGEST_SECRET>
```

The device `id` in `config.yaml` must equal the code registered under **Attendance Administration →
Door Terminals**. Keep the device IP, COMKey and fingerprint templates on the NAS; never put them in
VIA HR, Git or an internet-facing reverse proxy.

The SQLite `via_hr_deliveries` table is a durable outbox. Failed batches use exponential retry, and
each punch has a deterministic identifier so retries cannot duplicate PostgreSQL attendance.
The enrolled terminal name accompanies a punch so HR can manually identify an unfamiliar terminal
ID. VIA HR treats the name only as a matching aid and never as automatic proof of identity.
