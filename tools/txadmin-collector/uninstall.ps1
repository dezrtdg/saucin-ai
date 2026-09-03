param([switch]$RemoveData)

$ErrorActionPreference = 'Stop'
$TaskName = 'SaucinAI-txAdmin-Collector'
$InstallDirectory = "$env:ProgramData\SaucinAI\txadmin-collector"

if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
    Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
}
if ($RemoveData -and (Test-Path -LiteralPath $InstallDirectory)) {
    Remove-Item -LiteralPath $InstallDirectory -Recurse -Force
    Write-Host 'Collector task and local collector data removed.' -ForegroundColor Green
} else {
    Write-Host "Collector task removed. Local config and state remain at $InstallDirectory" -ForegroundColor Green
}
