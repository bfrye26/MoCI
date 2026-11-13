#Requires -Version 5.1
[CmdletBinding()]
param([string]$RouterAddress='192.168.50.1')
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$address=$null
if (-not [System.Net.IPAddress]::TryParse($RouterAddress,[ref]$address)) { throw 'RouterAddress must be an IP address.' }
$project=Split-Path -Parent $PSScriptRoot
$recordFile=Get-ChildItem -LiteralPath (Join-Path $project 'artifacts\validation-vm') -File -Filter 'MoCI-Release-Test-*.json' | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $recordFile) { throw 'No disposable VM record exists.' }
$record=Get-Content -LiteralPath $recordFile.FullName -Raw | ConvertFrom-Json
$sourceId='3164c3c8-a30a-4171-99ec-a4fc4bda96dd'
$cloneId=([guid]$record.uuid).ToString()
if ($record.source_uuid -ne $sourceId -or $cloneId -eq $sourceId -or $record.name -notlike 'MoCI-Release-Test-*') { throw 'Invalid disposable VM record.' }
$vbox='C:\Program Files\Oracle\VirtualBox\VBoxManage.exe'
function Get-VMInfo([string]$Id) {
    $lines=@(& $vbox showvminfo $Id --machinereadable)
    if ($LASTEXITCODE -ne 0) { throw "Cannot inspect VM $Id" }
    $values=@{}
    foreach ($line in $lines) { if ($line -match '^([^=]+)="(.*)"$') { $values[$matches[1].Trim('"')]=$matches[2] } }
    return $values
}
function Assert-TestVM {
    $source=Get-VMInfo $sourceId
    $clone=Get-VMInfo $cloneId
    if ($source['VMState'] -ne 'poweroff' -or $clone['VMState'] -ne 'running' -or $clone['name'] -ne $record.name) { throw 'MoCI3 must be off and the recorded disposable test VM must be running.' }
    if (-not $clone['hardwareuuid'] -or $clone['hardwareuuid'] -eq $source['hardwareuuid']) { throw 'The test VM identity is not distinct.' }
    return ([guid]$clone['hardwareuuid']).ToString()
}
$hardwareId=Assert-TestVM
if ((Get-PSDrive C).Free -lt 12GB) { throw 'At least 12 GB free on C: is required for the running-VM recovery snapshot.' }
$name='storage-grow-'+[DateTime]::UtcNow.ToString('yyyyMMddTHHmmssZ')+'-'+[guid]::NewGuid().ToString('N').Substring(0,8)
$output=Join-Path $project ('artifacts\'+$name)
New-Item -ItemType Directory -Path $output | Out-Null
$remote="root@$RouterAddress"
$stage='/root/'+$name
& ssh -o ConnectTimeout=10 -o ConnectionAttempts=1 $remote "mkdir -m 700 '$stage'"
if ($LASTEXITCODE -ne 0) { throw 'Could not prepare private staging. No storage changes started.' }
& scp -O (Join-Path $PSScriptRoot 'router-restore-check.py') (Join-Path $project 'firmware\files\usr\libexec\moci-grow-root') "${remote}:$stage/"
if ($LASTEXITCODE -ne 0) { throw 'Could not upload storage helpers.' }
& ssh $remote "python3 '$stage/router-restore-check.py' --verify-identity-only --expect-hardware-uuid '$hardwareId'"
if ($LASTEXITCODE -ne 0) { throw 'Remote identity did not match the disposable VM. No storage changes started.' }
$snapshot='before-storage-growth-'+[DateTime]::UtcNow.ToString('yyyyMMddTHHmmssZ')
Write-Host 'Creating a recovery snapshot of the disposable VM before installing tools or expanding storage.'
& $vbox snapshot $cloneId take $snapshot --description 'Before guarded MoCI root growth; original MoCI3 remains off'
if ($LASTEXITCODE -ne 0) { throw 'Recovery snapshot failed. No storage changes started.' }
@{test_vm=$cloneId;hardware_uuid=$hardwareId;snapshot=$snapshot;release_ready=$false} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $output 'storage-state.json') -Encoding UTF8
if ((Assert-TestVM) -ne $hardwareId) { throw 'VM identity changed after snapshot.' }
& ssh $remote "python3 '$stage/router-restore-check.py' --verify-identity-only --expect-hardware-uuid '$hardwareId' && (command -v sfdisk >/dev/null || /usr/libexec/moci-pkg-call install-general sfdisk) && (command -v partx >/dev/null || /usr/libexec/moci-pkg-call install-general partx-utils) && (command -v resize2fs >/dev/null || /usr/libexec/moci-pkg-call install-general resize2fs)"
if ($LASTEXITCODE -ne 0) { throw "Storage tools could not be installed. No partition growth started. Recovery snapshot: $snapshot" }
Write-Host 'Expanding only the recognised GPT/ext4 root on the disposable VM. Partition backups remain private on the router.'
& ssh -o ServerAliveInterval=10 -o ServerAliveCountMax=3 $remote "python3 '$stage/moci-grow-root' --apply --expect-hardware-uuid '$hardwareId' --output '$stage'"
$growthExit=$LASTEXITCODE
& scp -O "${remote}:$stage/storage-report.json" (Join-Path $output 'storage-report.json')
if ($LASTEXITCODE -ne 0) { throw "Could not retrieve storage report. Inspect the VM before retrying. Snapshot: $snapshot" }
$report=Get-Content -LiteralPath (Join-Path $output 'storage-report.json') -Raw | ConvertFrom-Json
if ($growthExit -ne 0 -or -not $report.success -or $report.PSObject.Properties.Name -contains 'skipped') { throw "Storage growth did not complete. Read $output\storage-report.json. Recovery snapshot: $snapshot" }
Write-Host ('Root capacity: {0:N2} GiB before, {1:N2} GiB after.' -f ($report.filesystem_before_bytes/1GB),($report.filesystem_after_bytes/1GB))
Write-Host "Storage repair completed. Report: $output\storage-report.json"
Write-Host 'Next run Test-MoCI-Upgrade.ps1 -VerifyOnly to recheck connectivity and retained settings. This manual repair does not validate automatic growth in a new firmware image.'
