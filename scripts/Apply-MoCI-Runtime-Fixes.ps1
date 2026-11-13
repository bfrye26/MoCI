#Requires -Version 5.1
[CmdletBinding()]
param([string]$RouterAddress='192.168.50.1',[switch]$DiagnoseOnly)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$address=$null
if (-not [System.Net.IPAddress]::TryParse($RouterAddress,[ref]$address)) { throw 'RouterAddress must be an IP address.' }
$project=Split-Path -Parent $PSScriptRoot
$recordFile=Get-ChildItem -LiteralPath (Join-Path $project 'artifacts\validation-vm') -File -Filter 'MoCI-Release-Test-*.json' | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $recordFile) { throw 'The disposable validation VM must be prepared first.' }
$record=Get-Content -LiteralPath $recordFile.FullName -Raw | ConvertFrom-Json
$sourceId='3164c3c8-a30a-4171-99ec-a4fc4bda96dd'
$cloneId=([guid]$record.uuid).ToString()
if ($record.source_uuid -ne $sourceId -or $cloneId -eq $sourceId -or $record.name -notlike 'MoCI-Release-Test-*') { throw 'Invalid validation VM record.' }
$vbox='C:\Program Files\Oracle\VirtualBox\VBoxManage.exe'
function Get-VMInfo([string]$Id) {
    $lines=@(& $vbox showvminfo $Id --machinereadable)
    if ($LASTEXITCODE -ne 0) { throw "Could not inspect VM $Id" }
    $values=@{}
    foreach ($line in $lines) { if ($line -match '^([^=]+)="(.*)"$') { $values[$matches[1].Trim('"')]=$matches[2] } }
    return $values
}
$source=Get-VMInfo $sourceId
$clone=Get-VMInfo $cloneId
if ($source['VMState'] -ne 'poweroff' -or $clone['VMState'] -ne 'running' -or $clone['name'] -ne $record.name) { throw 'MoCI3 must be off and the recorded disposable test VM must be running.' }
$hardwareId=([guid]$clone['hardwareuuid']).ToString()
if ($hardwareId -eq $source['hardwareuuid']) { throw 'The test VM hardware identity is not distinct.' }
$name='runtime-fix-'+[DateTime]::UtcNow.ToString('yyyyMMddTHHmmssZ')+'-'+[guid]::NewGuid().ToString('N').Substring(0,8)
$output=Join-Path $project ('artifacts\'+$name)
New-Item -ItemType Directory -Path $output | Out-Null
$remote="root@$RouterAddress"
$stage="/root/$name"
& ssh -o ConnectTimeout=10 -o ConnectionAttempts=1 $remote "mkdir -m 700 '$stage'"
if ($LASTEXITCODE -ne 0) { throw 'Could not prepare private staging. No repairs started.' }
& scp -O ((Join-Path $project 'firmware\files\usr\libexec\moci-runtime-defaults') -replace '\\','/') "${remote}:$stage/"
if ($LASTEXITCODE -ne 0) { throw 'Could not upload runtime repair helper.' }
$mode='--apply'
if ($DiagnoseOnly) {
    $mode='--diagnose-only'
    Write-Host 'Collecting Docker route, NAT and DNS probes. No network settings or services will be changed.'
} else {
    Write-Host 'Repairing only the disposable VM. Network and firewall settings are backed up under the private staging directory.'
    Write-Host 'The helper may restart an idle Docker daemon and pull the official BusyBox test image. It publishes no ports.'
}
& ssh -o ServerAliveInterval=10 -o ServerAliveCountMax=3 $remote "python3 '$stage/moci-runtime-defaults' $mode --live --expect-hardware-uuid '$hardwareId' --output '$stage'"
$repairExit=$LASTEXITCODE
& scp -O "${remote}:$stage/runtime-report.json" (Join-Path $output 'runtime-report.json')
if ($LASTEXITCODE -ne 0) { throw "Could not retrieve runtime report. Inspect the test VM; no pass recorded. Results: $output" }
$report=Get-Content -LiteralPath (Join-Path $output 'runtime-report.json') -Raw | ConvertFrom-Json
if ($repairExit -ne 0 -or -not $report.success) {
    $details=@($report.checks | Where-Object status -eq 'FAIL' | ForEach-Object { $_.name + ': ' + $_.detail }) -join [Environment]::NewLine
    if ($DiagnoseOnly) { throw "Diagnostic collection was incomplete:$([Environment]::NewLine)$details$([Environment]::NewLine)Report: $output\runtime-report.json" }
    throw "Runtime validation failed:$([Environment]::NewLine)$details$([Environment]::NewLine)Settings backup: $stage/before. Report: $output\runtime-report.json"
}
if ($DiagnoseOnly) { Write-Host "Diagnostic collection completed. This does not record a network pass. Report: $output\runtime-report.json"; return }
if ($report.plan.docker -eq 'PRESERVE_CUSTOM') { Write-Host 'Custom Docker configuration was preserved; default bridge checks were skipped.' }
Write-Host "Runtime repair checks completed. Report: $output\runtime-report.json"
Write-Host 'The next firmware image also includes these startup defaults. No firmware was flashed.'
