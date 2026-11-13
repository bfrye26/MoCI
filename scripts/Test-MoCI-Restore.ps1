#Requires -Version 5.1
[CmdletBinding()]
param([string]$RouterAddress = '192.168.50.1')
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$parsedAddress = $null
if (-not [System.Net.IPAddress]::TryParse($RouterAddress,[ref]$parsedAddress)) { throw 'RouterAddress must be an IP address.' }
$project = Split-Path -Parent $PSScriptRoot
$vbox = 'C:\Program Files\Oracle\VirtualBox\VBoxManage.exe'
$recordFile = Get-ChildItem -LiteralPath (Join-Path $project 'artifacts\validation-vm') -File -Filter 'MoCI-Release-Test-*.json' | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $recordFile) { throw 'No validation VM record exists. Run New-MoCI-ValidationVM.ps1 first.' }
$record = Get-Content -LiteralPath $recordFile.FullName -Raw | ConvertFrom-Json
$cloneId = ([guid]$record.uuid).ToString()
$sourceId = '3164c3c8-a30a-4171-99ec-a4fc4bda96dd'
if ($record.source_uuid -ne $sourceId -or $cloneId -eq $sourceId -or $record.name -notlike 'MoCI-Release-Test-*') { throw 'Invalid validation VM identity.' }
function Get-VMInfo([string]$Id) {
    $lines = @(& $vbox showvminfo $Id --machinereadable)
    if ($LASTEXITCODE -ne 0) { throw "Cannot inspect VM $Id" }
    $values = @{}
    foreach ($line in $lines) { if ($line -match '^([^=]+)="(.*)"$') { $values[$matches[1].Trim('"')] = $matches[2] } }
    return $values
}
function Assert-TestVM {
    $source = Get-VMInfo $sourceId
    $clone = Get-VMInfo $cloneId
    if ($source['VMState'] -ne 'poweroff' -or $clone['VMState'] -ne 'running' -or $clone['name'] -ne $record.name) { throw 'Original must be off and the recorded test VM must be running.' }
    if (-not $clone['hardwareuuid'] -or $clone['hardwareuuid'] -eq $source['hardwareuuid']) { throw 'Distinct clone hardware identity could not be verified.' }
    return ([guid]$clone['hardwareuuid']).ToString()
}
$hardwareId = Assert-TestVM
$name = 'restore-check-' + [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssZ') + '-' + [guid]::NewGuid().ToString('N').Substring(0,8)
$output = Join-Path $project ('artifacts\' + $name)
New-Item -ItemType Directory -Path $output | Out-Null
$stage = "/root/$name"
$remote = "root@$RouterAddress"
& ssh -o ConnectTimeout=10 -o ConnectionAttempts=1 $remote "mkdir -m 700 '$stage'"
if ($LASTEXITCODE -ne 0) { throw 'Could not create private test directory. No restore was attempted.' }
& scp -O (Join-Path $PSScriptRoot 'router-restore-check.py') (Join-Path $PSScriptRoot 'router-release-check.py') (Join-Path $PSScriptRoot 'router-client-check.py') "${remote}:$stage/"
if ($LASTEXITCODE -ne 0) { throw 'Could not stage test scripts.' }
$null = Assert-TestVM
Write-Host 'Testing fresh backup and restore on the disposable VM only.'
& ssh $remote "python3 '$stage/router-restore-check.py' --expect-hardware-uuid '$hardwareId'"
$restoreExit = $LASTEXITCODE
& scp -O "${remote}:$stage/restore-report.json" (Join-Path $output 'restore-report.json')
if ($LASTEXITCODE -ne 0) { throw "Could not retrieve restore report. Inspect the test VM. Results: $output" }
$restoreReport = Get-Content -LiteralPath (Join-Path $output 'restore-report.json') -Raw | ConvertFrom-Json
if ($restoreExit -ne 0 -or -not $restoreReport.restore_checks_passed) {
    $failed = @($restoreReport.checks | Where-Object status -eq 'FAIL' | ForEach-Object detail) -join '; '
    throw "Restore test stopped: $failed. No automatic power cycle will be attempted. Results: $output"
}
foreach ($file in @('configuration-backup.tar.gz','backup-sha256.txt')) {
    & scp -O "${remote}:$stage/$file" (Join-Path $output $file)
    if ($LASTEXITCODE -ne 0) { throw "Could not retrieve $file. Inspect $output and the test VM. Original VM remains preserved." }
}
$expected = (Get-Content -LiteralPath (Join-Path $output 'backup-sha256.txt') -Raw).Trim()
$actual = (Get-FileHash -LiteralPath (Join-Path $output 'configuration-backup.tar.gz') -Algorithm SHA256).Hash.ToLowerInvariant()
if ($expected -ne $actual -or $restoreExit -ne 0) { throw "Restore or backup checksum failed. Do not power-cycle automatically. Results: $output" }
$null = Assert-TestVM
Write-Host 'Restore content checks passed. Gracefully powering down the test VM before a cold start.'
& ssh $remote "python3 '$stage/router-restore-check.py' --expect-hardware-uuid '$hardwareId' --verify-identity-only && sync && poweroff"
if ($LASTEXITCODE -notin @(0,255)) { throw 'Test VM shutdown failed. No forced power-off used.' }
$deadline = [DateTime]::UtcNow.AddSeconds(120)
do {
    $state = (Get-VMInfo $cloneId)['VMState']
    if ($state -eq 'poweroff') { break }
    Start-Sleep -Seconds 2
} while ([DateTime]::UtcNow -lt $deadline)
if ($state -ne 'poweroff' -or (Get-VMInfo $sourceId)['VMState'] -ne 'poweroff') { throw 'Both VMs must be off before the test VM is restarted.' }
& $vbox startvm $cloneId --type gui
if ($LASTEXITCODE -ne 0) { throw 'Could not cold-start the test VM. Original VM remains preserved.' }
# Wait for SSH listening; this does not attempt password authentication.
$deadline = [DateTime]::UtcNow.AddSeconds(120)
$ready = $false
do {
    $connection = New-Object System.Net.Sockets.TcpClient
    try {
        $pending = $connection.BeginConnect($RouterAddress,22,$null,$null)
        if ($pending.AsyncWaitHandle.WaitOne(1500)) { $connection.EndConnect($pending); $ready = $true }
    } catch {} finally { $connection.Close() }
    if (-not $ready) { Start-Sleep -Seconds 2 }
} while (-not $ready -and [DateTime]::UtcNow -lt $deadline)
if (-not $ready) { throw 'The test VM did not restore SSH access within two minutes. Post-boot checks remain unverified.' }
$null = Assert-TestVM
& ssh $remote "python3 '$stage/router-restore-check.py' --expect-hardware-uuid '$hardwareId' --verify-only && mkdir -m 700 '$stage/post-boot' && cp '$stage/router-release-check.py' '$stage/post-boot/' && python3 '$stage/post-boot/router-release-check.py' && python3 '$stage/router-client-check.py'"
$postBootExit = $LASTEXITCODE
foreach ($file in @('restore-report.json','restore-post-boot.json','report.json','client-report.json')) {
    $remoteFile = "$stage/$file"
    if ($file -eq 'report.json') { $remoteFile = "$stage/post-boot/report.json" }
    & scp -O "${remote}:$remoteFile" (Join-Path $output $file)
    if ($LASTEXITCODE -ne 0) { throw "Could not retrieve post-boot $file. Results: $output" }
}
$release = Get-Content -LiteralPath (Join-Path $output 'report.json') -Raw | ConvertFrom-Json
$client = Get-Content -LiteralPath (Join-Path $output 'client-report.json') -Raw | ConvertFrom-Json
if ($postBootExit -ne 0 -or @($release.checks | Where-Object status -eq 'FAIL').Count -or -not $client.client_checks_passed -or $client.cleanup -ne 'PASS') { throw "Post-restore connectivity did not pass. Results: $output" }
$summary = [ordered]@{schema=1; test_vm=$cloneId; restore_content='PASS'; downloaded_backup_sha256=$expected; cold_start_access='PASS'; post_boot_router_checks='PASS'; post_boot_client_checks='PASS'; release_ready=$false; hardware='NOT_TESTED'; wan_isolation='NOT_TESTED'; upgrade='NOT_TESTED'}
$summary | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $output 'restore-summary.json') -Encoding UTF8
Write-Host "Disposable VM restore and cold-start checks passed. Results: $output"
Write-Host 'Keep configuration-backup.tar.gz private. Original MoCI3 must stay off while the test VM runs.'
