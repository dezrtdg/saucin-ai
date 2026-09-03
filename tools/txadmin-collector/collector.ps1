param(
    [string]$ConfigPath = "$env:ProgramData\SaucinAI\txadmin-collector\config.json"
)

$ErrorActionPreference = 'Stop'
$CollectorVersion = '1.0.2'
$InstallDirectory = Split-Path -Parent $ConfigPath
$StatePath = Join-Path $InstallDirectory 'state.json'
$PendingPath = Join-Path $InstallDirectory 'pending.json'
$CollectorLogPath = Join-Path $InstallDirectory 'collector.log'

function Write-CollectorLog {
    param([string]$Message)
    try {
        if ((Test-Path $CollectorLogPath) -and (Get-Item $CollectorLogPath).Length -gt 1048576) {
            Move-Item $CollectorLogPath "$CollectorLogPath.old" -Force
        }
        Add-Content -LiteralPath $CollectorLogPath -Value "$(Get-Date -Format o) $Message" -Encoding UTF8
    } catch { }
}

function Read-JsonFile {
    param([string]$Path, $Default)
    if (-not (Test-Path -LiteralPath $Path)) { return $Default }
    try { return Get-Content -LiteralPath $Path -Raw -Encoding UTF8 | ConvertFrom-Json }
    catch { Write-CollectorLog "Could not read ${Path}: $($_.Exception.Message)"; return $Default }
}

function Write-JsonFile {
    param([string]$Path, $Value)
    $temporary = "$Path.tmp"
    $json = ConvertTo-Json -InputObject $Value -Depth 10 -Compress
    if ([string]::IsNullOrEmpty([string]$json)) { $json = '[]' }
    $utf8 = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($temporary, [string]$json, $utf8)
    Move-Item -LiteralPath $temporary -Destination $Path -Force
}

function Protect-Text {
    param([string]$Text)
    $value = ($Text -replace '[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]', ' ') -replace '\s+', ' '
    $value = $value.Trim()
    $value = $value -replace '(?i)\b(?:license|license2|steam|discord|fivem|xbl|live):[a-z0-9]+\b', '[player-id redacted]'
    $value = $value -replace '(?i)\b(?:token|secret|password|passwd|api[_-]?key|authorization)\s*[:=]\s*[^\s,;]+', '[secret redacted]'
    $value = $value -replace '(?i)\bBearer\s+[A-Za-z0-9._~+/=-]+', 'Bearer [secret redacted]'
    $value = $value -replace '\b(?:\d{1,3}\.){3}\d{1,3}(?::\d{1,5})?\b', '[ip redacted]'
    $value = $value -replace '(?i)(?:\b(?:[0-9a-f]{1,4}:){3,}[0-9a-f]{0,4}\b|\b[0-9a-f]{0,4}::[0-9a-f:]{0,}\b)(?:%[\w.-]+)?', '[ip redacted]'
    $value = $value -replace '(?i)([?&](?:token|secret|key|password|auth)=)[^&#\s]+', '${1}[redacted]'
    if ($value.Length -gt 4000) { $value = $value.Substring(0, 4000) }
    return $value
}

function Get-Hash {
    param([string]$Value)
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try {
        $bytes = [System.Text.Encoding]::UTF8.GetBytes($Value)
        return ([BitConverter]::ToString($sha.ComputeHash($bytes))).Replace('-', '').ToLowerInvariant()
    } finally { $sha.Dispose() }
}

function Get-FxServerProcess {
    param([string]$ExecutablePath)
    try {
        $expected = [IO.Path]::GetFullPath($ExecutablePath)
        $processes = Get-CimInstance Win32_Process -Filter "Name='FXServer.exe'" -ErrorAction Stop
        foreach ($process in $processes) {
            if ($process.ExecutablePath -and [IO.Path]::GetFullPath([string]$process.ExecutablePath).Equals($expected, [StringComparison]::OrdinalIgnoreCase)) {
                return $process
            }
        }
    } catch { Write-CollectorLog "Could not query FXServer process state: $($_.Exception.Message)" }
    return $null
}

function Get-ResourceName {
    param([string]$Line)
    $patterns = @(
        '\[\s*script:([^\]\s]+)\s*\]',
        '(?i)\b(?:resource|script)\s+["'']?([a-z0-9_-]{2,80})["'']?',
        '(?i)\b(?:started|stopping|starting|failed to start)\s+(?:resource\s+)?([a-z0-9_-]{2,80})\b'
    )
    foreach ($pattern in $patterns) {
        $match = [regex]::Match($Line, $pattern)
        if ($match.Success) { return (Protect-Text $match.Groups[1].Value).Substring(0, [Math]::Min(160, $match.Groups[1].Value.Length)) }
    }
    return $null
}

function Convert-LogLineToEvent {
    param([string]$Line, [string]$RelativePath, [long]$LineNumber)
    $message = Protect-Text $Line
    if ([string]::IsNullOrWhiteSpace($message)) { return $null }
    $severity = $null; $category = 'general'; $eventType = $null
    if ($message -match '(?i)\b(crash(?:ed)?|fatal|segmentation fault|access violation|stack overflow)\b') {
        $severity = 'critical'; $category = 'crash'; $eventType = 'server.crash'
    } elseif ($message -match '(?i)\b(oxmysql|mysql|mariadb|database|sql)\b' -and $message -match '(?i)\b(error|failed|unable|exception|doesn''t have a default value|duplicate entry)\b') {
        $severity = 'error'; $category = 'database'; $eventType = 'database.error'
    } elseif ($message -match '(?i)\b(hitch warning|server thread hitch|took\s+\d+\s*(?:ms|milliseconds))\b') {
        $severity = 'warning'; $category = 'performance'; $eventType = 'performance.hitch'
    } elseif ($message -match '(?i)\b(failed to start|couldn''t start|unable to start)\b.*\b(resource|script)\b') {
        $severity = 'error'; $category = 'resource'; $eventType = 'resource.start_failed'
    } elseif ($message -match '(?i)\b(ensure|started|starting)\s+(?:resource\s+)?[a-z0-9_-]+\b') {
        $severity = 'info'; $category = 'resource'; $eventType = 'resource.started'
    } elseif ($message -match '(?i)\b(stopped|stopping)\s+(?:resource\s+)?[a-z0-9_-]+\b') {
        $severity = 'info'; $category = 'resource'; $eventType = 'resource.stopped'
    } elseif ($message -match '(?i)\b(error|exception|failed|failure|unable to|script error)\b') {
        $severity = 'error'; $category = if ($message -match '(?i)\b(resource|script:)') { 'resource' } else { 'server' }; $eventType = "$category.error"
    } elseif ($message -match '(?i)\b(warn(?:ing)?|deprecated|slow query)\b') {
        $severity = 'warning'; $category = if ($message -match '(?i)\bnetwork|socket|connection') { 'network' } else { 'server' }; $eventType = "$category.warning"
    }
    if (-not $eventType) { return $null }
    $resource = Get-ResourceName $message
    $canonical = ($message.ToLowerInvariant() -replace '\b\d{2,}\b', '#' -replace '0x[0-9a-f]+', '0x#' -replace '\s+', ' ').Trim()
    return [ordered]@{
        occurred_at = [DateTime]::UtcNow.ToString('o')
        severity = $severity
        event_type = $eventType
        category = $category
        resource_name = $resource
        message = $message
        fingerprint = Get-Hash "$eventType|$resource|$canonical"
        source_file = Protect-Text $RelativePath
        line_number = $LineNumber
        metadata = @{}
    }
}

function Convert-StateToMap {
    param($Loaded)
    $map = @{}
    if ($Loaded -and $Loaded.Files) {
        foreach ($property in $Loaded.Files.PSObject.Properties) {
            $map[$property.Name] = @{
                Offset = [long]$property.Value.Offset
                LineNumber = [long]$property.Value.LineNumber
                Carry = [string]$property.Value.Carry
            }
        }
    }
    return $map
}

function Save-StateMap {
    param([hashtable]$Map)
    $files = [ordered]@{}
    foreach ($key in $Map.Keys) { $files[$key] = $Map[$key] }
    Write-JsonFile $StatePath ([ordered]@{ Files = $files; UpdatedAt = [DateTime]::UtcNow.ToString('o') })
}

if (-not (Test-Path -LiteralPath $ConfigPath)) { throw "Collector config was not found: $ConfigPath" }
$config = Read-JsonFile $ConfigPath $null
if (-not $config) { throw 'Collector config is invalid.' }
foreach ($required in @('Endpoint','Token','TxDataPath','FxServerPath','ServerName','CollectorId')) {
    if ([string]::IsNullOrWhiteSpace([string]$config.$required)) { throw "Collector config is missing $required." }
}
$txDataFull = [IO.Path]::GetFullPath([Environment]::ExpandEnvironmentVariables([string]$config.TxDataPath)).TrimEnd('\')
if (-not (Test-Path -LiteralPath $txDataFull -PathType Container)) { throw "txData path does not exist: $txDataFull" }
$fxServerDirectory = [IO.Path]::GetFullPath([Environment]::ExpandEnvironmentVariables([string]$config.FxServerPath)).TrimEnd('\')
$fxServerExecutable = Join-Path $fxServerDirectory 'FXServer.exe'
if (-not (Test-Path -LiteralPath $fxServerExecutable -PathType Leaf)) { throw "FXServer.exe does not exist: $fxServerExecutable" }

$mutex = New-Object Threading.Mutex($false, 'Global\SaucinAI_txAdmin_Collector')
if (-not $mutex.WaitOne(0, $false)) { Write-CollectorLog 'Another collector instance is already running.'; exit 0 }

try {
    $state = Convert-StateToMap (Read-JsonFile $StatePath $null)
    $pendingLoaded = Read-JsonFile $PendingPath @()
    $pending = New-Object System.Collections.ArrayList
    if ($pendingLoaded) { foreach ($item in @($pendingLoaded)) { [void]$pending.Add($item) } }
    $lastHeartbeat = [DateTime]::MinValue
    $lastFxServerRunning = $null
    $scanSeconds = [Math]::Max(2, [int]$config.ScanIntervalSeconds)
    $heartbeatSeconds = [Math]::Max(15, [int]$config.HeartbeatSeconds)
    $maxBatch = [Math]::Min(100, [Math]::Max(1, [int]$config.MaxBatchSize))
    Write-CollectorLog "Collector $CollectorVersion started for $txDataFull"

    while ($true) {
        try {
            $files = Get-ChildItem -LiteralPath $txDataFull -Filter '*.log' -File -Recurse -ErrorAction SilentlyContinue
            foreach ($file in $files) {
                $relative = $file.FullName.Substring($txDataFull.Length).TrimStart('\')
                if (-not $state.ContainsKey($file.FullName)) {
                    $initialOffset = if ([bool]$config.StartAtEnd) { [long]$file.Length } else { 0L }
                    $state[$file.FullName] = @{ Offset = $initialOffset; LineNumber = 0L; Carry = '' }
                    continue
                }
                $fileState = $state[$file.FullName]
                if ([long]$file.Length -lt [long]$fileState.Offset) { $fileState.Offset = 0L; $fileState.LineNumber = 0L; $fileState.Carry = '' }
                if ([long]$file.Length -eq [long]$fileState.Offset) { continue }
                $stream = New-Object IO.FileStream($file.FullName, [IO.FileMode]::Open, [IO.FileAccess]::Read, ([IO.FileShare]::ReadWrite -bor [IO.FileShare]::Delete))
                try {
                    [void]$stream.Seek([long]$fileState.Offset, [IO.SeekOrigin]::Begin)
                    $reader = New-Object IO.StreamReader($stream, [Text.Encoding]::UTF8, $true, 4096, $true)
                    try { $chunk = $reader.ReadToEnd(); $newOffset = $stream.Position } finally { $reader.Dispose() }
                } finally { $stream.Dispose() }
                $combined = [string]$fileState.Carry + $chunk
                $hasCompleteEnd = $combined.EndsWith("`n") -or $combined.EndsWith("`r")
                $parts = @($combined -split "`r?`n", -1)
                if ($hasCompleteEnd) { $fileState.Carry = ''; if ($parts.Count -gt 0 -and $parts[-1] -eq '') { $parts = $parts[0..($parts.Count-2)] } }
                else { $fileState.Carry = if ($parts.Count) { [string]$parts[-1] } else { '' }; if ($parts.Count -gt 1) { $parts = $parts[0..($parts.Count-2)] } else { $parts = @() } }
                foreach ($line in $parts) {
                    $fileState.LineNumber = [long]$fileState.LineNumber + 1
                    $event = Convert-LogLineToEvent ([string]$line) $relative ([long]$fileState.LineNumber)
                    if ($event) { [void]$pending.Add($event) }
                }
                $fileState.Offset = [long]$newOffset
                $state[$file.FullName] = $fileState
            }
            while ($pending.Count -gt 2000) { $pending.RemoveAt(0) }
            Save-StateMap $state
            Write-JsonFile $PendingPath @($pending)

            $heartbeatDue = ([DateTime]::UtcNow - $lastHeartbeat).TotalSeconds -ge $heartbeatSeconds
            if ($pending.Count -gt 0 -or $heartbeatDue) {
                $fxProcess = Get-FxServerProcess $fxServerExecutable
                $fxServerRunning = $null -ne $fxProcess
                if ($null -ne $lastFxServerRunning -and $lastFxServerRunning -ne $fxServerRunning) {
                    $processMessage = if ($fxServerRunning) { 'FXServer process started.' } else { 'FXServer process stopped or is no longer reachable.' }
                    $processEvent = [ordered]@{
                        occurred_at = [DateTime]::UtcNow.ToString('o')
                        severity = if ($fxServerRunning) { 'info' } else { 'critical' }
                        event_type = if ($fxServerRunning) { 'server.process_started' } else { 'server.process_stopped' }
                        category = 'server'
                        resource_name = $null
                        message = $processMessage
                        fingerprint = Get-Hash $processMessage
                        source_file = 'FXServer.exe'
                        line_number = $null
                        metadata = @{ process_id = if ($fxProcess) { [int]$fxProcess.ProcessId } else { $null } }
                    }
                    [void]$pending.Add($processEvent)
                }
                $lastFxServerRunning = $fxServerRunning
                $take = [Math]::Min($maxBatch, $pending.Count)
                $batch = @()
                if ($take -gt 0) { $batch = @($pending.GetRange(0, $take)) }
                $payload = [ordered]@{
                    collector_id = [string]$config.CollectorId
                    server_name = [string]$config.ServerName
                    hostname = [Environment]::MachineName
                    txdata_path = $txDataFull
                    collector_version = $CollectorVersion
                    heartbeat_at = [DateTime]::UtcNow.ToString('o')
                    metadata = @{
                        operating_system = [Environment]::OSVersion.VersionString
                        powershell = $PSVersionTable.PSVersion.ToString()
                        fxserver_running = $fxServerRunning
                        fxserver_process_id = if ($fxProcess) { [int]$fxProcess.ProcessId } else { $null }
                        fxserver_path = $fxServerExecutable
                    }
                    events = $batch
                }
                $headers = @{ Authorization = "Bearer $($config.Token)" }
                $json = $payload | ConvertTo-Json -Depth 10 -Compress
                $null = Invoke-RestMethod -Uri ([string]$config.Endpoint) -Method Post -Headers $headers -ContentType 'application/json' -Body $json -TimeoutSec 20 -UseBasicParsing
                for ($index = 0; $index -lt $take; $index++) { $pending.RemoveAt(0) }
                Write-JsonFile $PendingPath @($pending)
                $lastHeartbeat = [DateTime]::UtcNow
            }
        } catch { Write-CollectorLog "Collector cycle failed: $($_.Exception.Message)" }
        Start-Sleep -Seconds $scanSeconds
    }
} finally {
    try { $mutex.ReleaseMutex() } catch { }
    $mutex.Dispose()
}
