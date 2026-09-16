# One-time pairing and automatic startup

For an existing Windows installation, double-click **Repair VIA Attendance Startup.cmd**
in this folder and approve Windows administrator access. No new pairing code is needed.
If repair fails, open PowerShell as Administrator and run `repair-startup.ps1` from this
folder to see the error. Do not reinstall, delete data, or generate a new code to fix
a temporary network outage.

The repair preserves the database, config.yaml and via_hr_connection.json under
`C:\ProgramData\VIA Attendance\data`. Only the startup launcher and the named scheduled
task are updated. Existing data-folder permissions remain unchanged.

The task runs as SYSTEM at startup without a Windows login or browser window. It has
no execution timeout, runs on battery power, and ignores duplicate task starts. A
five-minute recovery trigger restarts a stopped task; the launcher retries an exited
connector process every 30 seconds. A bounded startup-recovery.log in the protected
data folder records restarts without credentials or attendance data.

Check after repair:

1. Open http://127.0.0.1:5580/admin/connector-setup and confirm the existing pairing.
2. Restart Windows. Wait for startup, then open that same page. Do not pair again.
3. Make a test punch and confirm it reaches VIA HR after the polling/delivery interval.
4. Temporarily disconnect internet, restore it, and confirm queued records arrive once.
   Delivery retries back off up to one hour following repeated network failures.

The office computer must be powered on and awake to collect records. While it is off
or asleep, records stay on the terminal (subject to terminal capacity) until polling
resumes. Network/device outages may show offline; that is not the same as losing pairing.
Revoked credentials, a replacement computer, or deleted pairing data need administrator
attention. Keep the machine IP stable. Do not clear the terminal's attendance log.
