[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    # The user approves UAC; never relax the protected data-folder permissions.
    $child = Start-Process powershell.exe -Verb RunAs -WindowStyle Hidden -Wait -PassThru -ArgumentList @(
        '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ('"{0}"' -f $PSCommandPath)
    )
    exit $child.ExitCode
}

$installRoot = Join-Path $env:ProgramData 'VIA Attendance'
$applicationRoot = Join-Path $installRoot 'app'
$dataRoot = Join-Path $installRoot 'data'
$venvPython = Join-Path $installRoot '.venv\Scripts\python.exe'
$launcherPath = Join-Path $installRoot 'start-connector.ps1'
$taskName = 'VIA Attendance Connector'
foreach ($required in @($venvPython, (Join-Path $applicationRoot 'app.py'), $dataRoot)) {
    if (-not (Test-Path -LiteralPath $required)) {
        throw 'Install VIA Attendance first. Startup repair does not create or reset an installation.'
    }
}

# Fixed, machine-wide paths keep the same pairing and queued punches after reboot.
# This repair never edits the database, terminal configuration or pairing file.
$launcher = @"
`$ErrorActionPreference = 'Stop'
`$env:DATA_DIR = '$($dataRoot.Replace("'", "''"))'
`$env:CONFIG_PATH = Join-Path `$env:DATA_DIR 'config.yaml'
`$env:VIA_HR_CONNECTION_PATH = Join-Path `$env:DATA_DIR 'via_hr_connection.json'
`$env:ADMIN_PASSWORD_FILE = Join-Path `$env:DATA_DIR 'bootstrap-password'
`$env:VIA_HR_URL = 'https://hr.via-int.com'
`$env:HOST = '127.0.0.1'
`$env:PORT = '5580'
`$env:SCHEDULER_ENABLED = '1'
Set-Location -LiteralPath '$($applicationRoot.Replace("'", "''"))'
while (`$true) {
    # Keep retrying if the process exits. No credentials or attendance enter this log.
    try {
        & '$($venvPython.Replace("'", "''"))' app.py
    } catch { }
    try {
        `$log = Join-Path `$env:DATA_DIR 'startup-recovery.log'
        if ((Test-Path -LiteralPath `$log) -and (Get-Item -LiteralPath `$log).Length -gt 1MB) {
            Move-Item -LiteralPath `$log -Destination (`$log + '.previous') -Force
        }
        Add-Content -LiteralPath `$log -Value ((Get-Date -Format o) + ' Connector exited; retrying in 30 seconds.')
    } catch { }
    Start-Sleep -Seconds 30
}
"@

$action = New-ScheduledTaskAction -Execute "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" -Argument (
    '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "{0}"' -f $launcherPath
)
$triggers = @(
    (New-ScheduledTaskTrigger -AtStartup),
    (New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(5) -RepetitionInterval (New-TimeSpan -Minutes 5))
)
$taskPrincipal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit ([TimeSpan]::Zero) `
    -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew `
    -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1)

# Stop only this installation's named task; never kill another BioTime installation.
$existing = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($existing) {
    Stop-ScheduledTask -TaskName $taskName
    for ($attempt = 0; $attempt -lt 30; $attempt++) {
        if ((Get-ScheduledTask -TaskName $taskName).State -ne 'Running') { break }
        Start-Sleep -Seconds 1
    }
    if ((Get-ScheduledTask -TaskName $taskName).State -eq 'Running') {
        throw 'The connector task did not stop. No startup files have been changed.'
    }
}
# Refuse to create a second collector if another process already owns the port.
if (Get-NetTCPConnection -State Listen -LocalPort 5580 -ErrorAction SilentlyContinue) {
    throw 'Another process is using port 5580. Close the manually started connector and run startup repair again.'
}
[IO.File]::WriteAllText($launcherPath, $launcher, [Text.UTF8Encoding]::new($false))
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $triggers `
    -Principal $taskPrincipal -Settings $settings -Force | Out-Null
Start-ScheduledTask -TaskName $taskName
Write-Host 'Automatic startup repaired. Existing pairing and attendance records were preserved.'
