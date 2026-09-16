[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

$expectedLogin = 'TruJ0e'
$login = (gh api user --jq .login).Trim()
if ($LASTEXITCODE -ne 0 -or $login -ne $expectedLogin) {
    throw "Unexpected GitHub CLI identity: $login"
}
Write-Host "Recovery host: $env:COMPUTERNAME; GitHub identity: $login"

$schtasks = Join-Path $env:SystemRoot 'System32\schtasks.exe'
$cmd = Join-Path $env:SystemRoot 'System32\cmd.exe'

function Invoke-Schtasks([string[]]$Arguments) {
    $out = Join-Path $env:TEMP ("schtasks-" + [guid]::NewGuid().ToString('N') + '.out')
    $err = Join-Path $env:TEMP ("schtasks-" + [guid]::NewGuid().ToString('N') + '.err')
    try {
        $p = Start-Process -FilePath $schtasks -ArgumentList $Arguments -Wait -PassThru -NoNewWindow -RedirectStandardOutput $out -RedirectStandardError $err
        return [int]$p.ExitCode
    } finally {
        Remove-Item -LiteralPath $out,$err -Force -ErrorAction SilentlyContinue
    }
}

function Get-RunnerState([string]$Repo, [string]$RunnerName) {
    $raw = gh api "repos/TruJ0e/$Repo/actions/runners" | ConvertFrom-Json
    if ($LASTEXITCODE -ne 0) { throw "Could not read Actions runner state for TruJ0e/$Repo." }
    return @($raw.runners | Where-Object { $_.name -eq $RunnerName }) | Select-Object -First 1
}

function Get-ListenerCount([string]$Dir) {
    try {
        return @(Get-CimInstance Win32_Process -Filter "Name='Runner.Listener.exe'" -ErrorAction Stop | Where-Object {
            ($_.ExecutablePath -and $_.ExecutablePath.StartsWith($Dir, [System.StringComparison]::OrdinalIgnoreCase)) -or
            ($_.CommandLine -and $_.CommandLine.IndexOf($Dir, [System.StringComparison]::OrdinalIgnoreCase) -ge 0)
        }).Count
    } catch {
        return 0
    }
}

function Install-RunnerTask([string]$TaskName, [string]$RunnerDir) {
    $runCmd = Join-Path $RunnerDir 'run.cmd'
    if (-not (Test-Path -LiteralPath $runCmd -PathType Leaf)) {
        throw "Runner entrypoint missing: $runCmd"
    }

    $identity = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
    $xmlPath = Join-Path $env:TEMP ("runner-task-" + [guid]::NewGuid().ToString('N') + '.xml')
    $xml = @"
<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.4" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <Triggers>
    <LogonTrigger><Enabled>true</Enabled><UserId>$([Security.SecurityElement]::Escape($identity))</UserId></LogonTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author"><UserId>$([Security.SecurityElement]::Escape($identity))</UserId><LogonType>InteractiveToken</LogonType><RunLevel>LeastPrivilege</RunLevel></Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <StartWhenAvailable>true</StartWhenAvailable>
    <RestartOnFailure><Interval>PT1M</Interval><Count>10</Count></RestartOnFailure>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
    <Enabled>true</Enabled>
  </Settings>
  <Actions Context="Author">
    <Exec><Command>$([Security.SecurityElement]::Escape($cmd))</Command><Arguments>/d /s /c &quot;&quot;$([Security.SecurityElement]::Escape($runCmd))&quot;&quot;</Arguments><WorkingDirectory>$([Security.SecurityElement]::Escape($RunnerDir))</WorkingDirectory></Exec>
  </Actions>
</Task>
"@

    try {
        Set-Content -LiteralPath $xmlPath -Value $xml -Encoding Unicode
        if ((Invoke-Schtasks @('/Create','/TN',$TaskName,'/XML',$xmlPath,'/F')) -ne 0) {
            throw "Failed to register runner task '$TaskName'."
        }
    } finally {
        Remove-Item -LiteralPath $xmlPath -Force -ErrorAction SilentlyContinue
    }
}

function Ensure-Runner([string]$Repo, [string]$RunnerName, [string]$RunnerDir, [string]$TaskName) {
    $record = Get-RunnerState $Repo $RunnerName
    if (-not $record) { throw "Runner '$RunnerName' is not registered for TruJ0e/$Repo." }

    $listeners = Get-ListenerCount $RunnerDir
    Write-Host "$Repo before: status=$($record.status) busy=$($record.busy) listeners=$listeners"
    if ($listeners -gt 1) { throw "$Repo has duplicate local listeners ($listeners)." }

    if ($record.status -eq 'online' -and $listeners -eq 1) {
        Write-Host "$Repo runner already healthy."
        return
    }

    # Prefer an existing Actions runner service when one is tied to this directory.
    $service = Get-CimInstance Win32_Service -ErrorAction SilentlyContinue | Where-Object {
        $_.PathName -and $_.PathName.IndexOf($RunnerDir, [System.StringComparison]::OrdinalIgnoreCase) -ge 0
    } | Select-Object -First 1

    if ($service) {
        Write-Host "Restarting $Repo runner service '$($service.Name)'."
        if ($service.State -eq 'Running') {
            & sc.exe stop $service.Name | Out-Null
            Start-Sleep -Seconds 2
        }
        & sc.exe start $service.Name | Out-Null
    } else {
        Install-RunnerTask $TaskName $RunnerDir
        [void](Invoke-Schtasks @('/End','/TN',$TaskName))
        if ((Invoke-Schtasks @('/Run','/TN',$TaskName)) -ne 0) {
            throw "Failed to start runner task '$TaskName'."
        }
    }

    $deadline = (Get-Date).AddSeconds(90)
    do {
        Start-Sleep -Seconds 3
        $record = Get-RunnerState $Repo $RunnerName
        $listeners = Get-ListenerCount $RunnerDir
        if ($listeners -gt 1) { throw "$Repo recovery created duplicate listeners ($listeners)." }
    } while (($record.status -ne 'online' -or $listeners -ne 1) -and (Get-Date) -lt $deadline)

    if ($record.status -ne 'online' -or $listeners -ne 1) {
        throw "$Repo runner recovery failed: status=$($record.status) listeners=$listeners"
    }
    Write-Host "$Repo recovered: online with one listener."
}

Ensure-Runner 'Commander' 'TruJoe-Commander' (Join-Path $env:USERPROFILE 'actions-runners\Commander') 'GitHubRunner-Commander'
Ensure-Runner 'TruJoe-AOS' 'TruJoe-TAOS' (Join-Path $env:USERPROFILE 'actions-runners\TAOS') 'GitHubRunner-TAOS'

function Test-Task([string]$Name) {
    return (Invoke-Schtasks @('/Query','/TN',$Name)) -eq 0
}

$owner = if (Test-Task 'TruTrol') { 'TruTrol' } elseif (Test-Task 'OpenCommander') { 'OpenCommander' } else { $null }
if (-not $owner) {
    throw 'Neither TruTrol nor OpenCommander owner task is registered.'
}

Write-Host "Starting single remote-control owner task: $owner"
if ((Invoke-Schtasks @('/Run','/TN',$owner)) -ne 0) {
    throw "Could not start remote-control owner task '$owner'."
}

$installRoot = @(
    (Join-Path $env:LOCALAPPDATA 'TruTrol'),
    (Join-Path $env:LOCALAPPDATA 'OpenCommander')
) | Where-Object { Test-Path (Join-Path $_ 'current\dist\cli\commander.js') } | Select-Object -First 1

if (-not $installRoot) { throw 'No installed TruTrol/OpenCommander runtime was found.' }
$cli = Join-Path $installRoot 'current\dist\cli\commander.js'
$configDir = Join-Path $installRoot 'data'

$ready = $false
for ($attempt = 1; $attempt -le 20; $attempt++) {
    Start-Sleep -Seconds 3
    & node $cli status --config-dir $configDir *> $null
    if ($LASTEXITCODE -eq 0) { $ready = $true; break }
}
if (-not $ready) { throw 'TruTrol/OpenCommander runtime did not become ready.' }

Write-Host "Remote-control runtime ready from $installRoot using owner '$owner'."
