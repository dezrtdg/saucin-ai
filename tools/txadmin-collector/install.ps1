param(
    [string]$Token = '',
    [string]$TxDataPath = 'C:\Users\mgsau\Desktop\Saucin qbox\txData',
    [string]$FxServerPath = 'C:\Users\mgsau\Desktop\Saucin qbox\server',
    [string]$Endpoint = 'https://ai.saucinrp.com/api/txadmin/ingest',
    [string]$ServerName = 'Saucin RP',
    [string]$CollectorId = 'saucin-rp-main'
)

$ErrorActionPreference = 'Stop'
$TaskName = 'SaucinAI-txAdmin-Collector'
$InstallDirectory = "$env:ProgramData\SaucinAI\txadmin-collector"
$ConfigPath = Join-Path $InstallDirectory 'config.json'
$CollectorSource = Join-Path $PSScriptRoot 'collector.ps1'
$CollectorDestination = Join-Path $InstallDirectory 'collector.ps1'

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Open PowerShell as Administrator, then run install.ps1 again.'
}
if (-not (Test-Path -LiteralPath $TxDataPath -PathType Container)) { throw "txData path does not exist: $TxDataPath" }
if (-not (Test-Path -LiteralPath $FxServerPath -PathType Container)) { throw "FXServer directory does not exist: $FxServerPath" }
$FxServerExecutable = Join-Path $FxServerPath 'FXServer.exe'
if (-not (Test-Path -LiteralPath $FxServerExecutable -PathType Leaf)) { throw "FXServer.exe was not found: $FxServerExecutable" }
if (-not (Test-Path -LiteralPath $CollectorSource -PathType Leaf)) { throw "collector.ps1 was not found beside this installer." }
if ([string]::IsNullOrWhiteSpace($Token)) {
    $secureToken = Read-Host 'Paste the TXADMIN_COLLECTOR_TOKEN from your Unraid .env file' -AsSecureString
    $tokenPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureToken)
    try { $Token = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($tokenPointer) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($tokenPointer) }
}
if ($Token.Length -lt 32) { throw 'The collector token must be at least 32 characters.' }

New-Item -ItemType Directory -Path $InstallDirectory -Force | Out-Null
Copy-Item -LiteralPath $CollectorSource -Destination $CollectorDestination -Force
$config = [ordered]@{
    Endpoint = $Endpoint
    Token = $Token
    TxDataPath = [IO.Path]::GetFullPath($TxDataPath)
    FxServerPath = [IO.Path]::GetFullPath($FxServerPath)
    ServerName = $ServerName
    CollectorId = $CollectorId
    ScanIntervalSeconds = 5
    HeartbeatSeconds = 30
    MaxBatchSize = 100
    StartAtEnd = $true
}
$config | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $ConfigPath -Encoding UTF8

& icacls.exe $InstallDirectory /inheritance:r /grant:r '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' | Out-Null
$arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$CollectorDestination`" -ConfigPath `"$ConfigPath`""
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $arguments
$trigger = New-ScheduledTaskTrigger -AtStartup
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 10 -RestartInterval (New-TimeSpan -Minutes 1) -StartWhenAvailable -MultipleInstances IgnoreNew -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
$taskPrincipal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Principal $taskPrincipal -Description 'Read-only Saucin AI txAdmin log collector' -Force | Out-Null
Start-ScheduledTask -TaskName $TaskName

Write-Host ''
Write-Host 'Saucin AI txAdmin collector installed and started.' -ForegroundColor Green
Write-Host "txData: $($config.TxDataPath)"
Write-Host "FXServer: $($config.FxServerPath)\FXServer.exe"
Write-Host "Endpoint: $Endpoint"
Write-Host 'Open the Saucin AI dashboard, then select txAdmin. It should show online within 30 seconds.'
