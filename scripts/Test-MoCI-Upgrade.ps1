#Requires -Version 5.1
[CmdletBinding()]
param([string]$RouterAddress='192.168.50.1',[switch]$VerifyOnly)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$address=$null
if (-not [System.Net.IPAddress]::TryParse($RouterAddress,[ref]$address)) { throw 'RouterAddress must be an IP address.' }
$project=Split-Path -Parent $PSScriptRoot
$build='C:\moci-build\ship-8cd226c8b7b8-20261113T170016Z'
$image=Join-Path $build 'openwrt-x86-64-generic-ext4-combined-efi.img.gz'
$imageHash='730e8bce878515b248de90a304d2668019a09fe909b7e4921b538f7fdb6be305'
$sourceCommit='8cd226c8b7b8689990a17ad953820a5d12b36750'
if ((Get-Content -LiteralPath (Join-Path $build 'source-versions.txt') -Raw) -notmatch "(?m)^MOCI_COMMIT=$sourceCommit\r?$" -or (Get-FileHash -LiteralPath $image -Algorithm SHA256).Hash.ToLowerInvariant() -ne $imageHash) { throw 'Candidate source or firmware checksum mismatch.' }
$vbox='C:\Program Files\Oracle\VirtualBox\VBoxManage.exe'
$recordFile=Get-ChildItem -LiteralPath (Join-Path $project 'artifacts\validation-vm') -File -Filter 'MoCI-Release-Test-*.json' | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $recordFile) { throw 'No disposable VM record exists.' }
$record=Get-Content -LiteralPath $recordFile.FullName -Raw | ConvertFrom-Json
$sourceId='3164c3c8-a30a-4171-99ec-a4fc4bda96dd'
$cloneId=([guid]$record.uuid).ToString()
if ($record.source_uuid -ne $sourceId -or $cloneId -eq $sourceId -or $record.name -notlike 'MoCI-Release-Test-*') { throw 'Invalid disposable VM record.' }
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
    if (-not $clone['hardwareuuid'] -or $clone['hardwareuuid'] -eq $source['hardwareuuid']) { throw 'Could not verify distinct test VM hardware identity.' }
    return ([guid]$clone['hardwareuuid']).ToString()
}
$hardwareId=Assert-TestVM
$remote="root@$RouterAddress"
if ($VerifyOnly) {
    $latest=Get-ChildItem -LiteralPath (Join-Path $project 'artifacts') -Directory -Filter 'upgrade-check-*' | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if (-not $latest) { throw 'No upgrade test has been prepared.' }
    $output=$latest.FullName
    $state=Get-Content -LiteralPath (Join-Path $output 'upgrade-state.json') -Raw | ConvertFrom-Json
    if ($state.test_vm -ne $cloneId -or $state.hardware_uuid -ne $hardwareId -or $state.image_sha256 -ne $imageHash) { throw 'Upgrade record does not match this test VM/image.' }
    $stage='/tmp/'+$latest.Name
} else {
    if ((Get-PSDrive C).Free -lt 20GB) { throw 'At least 20 GB free on C: is required for the running-VM snapshot and upgrade disk changes.' }
    $name='upgrade-check-'+[DateTime]::UtcNow.ToString('yyyyMMddTHHmmssZ')+'-'+[guid]::NewGuid().ToString('N').Substring(0,8)
    $output=Join-Path $project ('artifacts\'+$name)
    New-Item -ItemType Directory -Path $output | Out-Null
    $stage='/tmp/'+$name
}
& ssh -o ConnectTimeout=10 -o ConnectionAttempts=1 $remote "mkdir -p -m 700 '$stage'"
if ($LASTEXITCODE -ne 0) { throw 'Could not prepare upgrade staging. No flash started.' }
$scripts=@('router-upgrade-check.py','router-release-check.py','router-client-check.py') | ForEach-Object { Join-Path $PSScriptRoot $_ }
& scp -O @scripts "${remote}:$stage/"
if ($LASTEXITCODE -ne 0) { throw 'Could not upload upgrade validation scripts.' }
if ($VerifyOnly) {
    & scp -O (Join-Path $output 'upgrade-preflight.json') "${remote}:$stage/upgrade-preflight.json"
    if ($LASTEXITCODE -ne 0) { throw 'Could not upload retained configuration baseline.' }
    & ssh -o ServerAliveInterval=10 -o ServerAliveCountMax=3 $remote "python3 '$stage/router-upgrade-check.py' --verify --expect-hardware-uuid '$hardwareId'"
    $verifyExit=$LASTEXITCODE
    & scp -O "${remote}:$stage/upgrade-post.json" (Join-Path $output 'upgrade-post.json')
    if ($LASTEXITCODE -ne 0) { throw 'Could not retrieve upgrade verification report.' }
    $result=Get-Content -LiteralPath (Join-Path $output 'upgrade-post.json') -Raw | ConvertFrom-Json
    if ($verifyExit -ne 0 -or -not $result.success) { throw "Upgrade verification failed. Results: $output" }
    foreach ($file in @('report.json','client-report.json')) {
        & scp -O "${remote}:$stage/$file" (Join-Path $output $file)
        if ($LASTEXITCODE -ne 0) { throw "Could not retrieve $file" }
    }
    Write-Host "Upgrade to rc.4, retained router settings and post-upgrade connectivity passed. Results: $output"
    Write-Host 'This does not validate physical hardware, external WAN isolation or app-data migration.'
    return
}
& scp -O $image "${remote}:$stage/candidate.img.gz"
if ($LASTEXITCODE -ne 0) { throw 'Could not upload firmware. No flash started.' }
& ssh $remote "python3 '$stage/router-upgrade-check.py' --prepare --expect-hardware-uuid '$hardwareId'"
$prepareExit=$LASTEXITCODE
& scp -O "${remote}:$stage/upgrade-preflight.json" (Join-Path $output 'upgrade-preflight.json')
if ($LASTEXITCODE -ne 0) { throw 'Could not retrieve preflight report. No flash started.' }
$preflight=Get-Content -LiteralPath (Join-Path $output 'upgrade-preflight.json') -Raw | ConvertFrom-Json
if ($prepareExit -ne 0 -or -not $preflight.success) { throw "Upgrade preflight failed. No flash started. Read $output\upgrade-preflight.json" }
& scp -O "${remote}:$stage/configuration-backup.tar.gz" (Join-Path $output 'configuration-backup.tar.gz')
if ($LASTEXITCODE -ne 0 -or (Get-FileHash -LiteralPath (Join-Path $output 'configuration-backup.tar.gz') -Algorithm SHA256).Hash.ToLowerInvariant() -ne $preflight.backup_sha256) { throw 'Backup download/checksum failed. No flash started.' }
$snapshot='before-rc4-upgrade-'+[DateTime]::UtcNow.ToString('yyyyMMddTHHmmssZ')
Write-Host 'Creating a recovery snapshot of the test VM. This can take several minutes.'
& $vbox snapshot $cloneId take $snapshot --description 'Before checksum-validated MoCI rc.4 upgrade; original MoCI3 remains off'
if ($LASTEXITCODE -ne 0) { throw 'Snapshot failed. No flash started.' }
$null=Assert-TestVM
$state=[ordered]@{test_vm=$cloneId; hardware_uuid=$hardwareId; image_sha256=$imageHash; source_commit=$sourceCommit; recovery_snapshot=$snapshot; release_ready=$false; flash_requested=$true}
$state | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $output 'upgrade-state.json') -Encoding UTF8
Write-Host 'Flashing the verified rc.4 image on the disposable VM only. Keep MoCI3 off and do not interrupt the test VM.'
& ssh -o ServerAliveInterval=10 -o ServerAliveCountMax=3 $remote "python3 '$stage/router-upgrade-check.py' --flash --expect-hardware-uuid '$hardwareId'"
$flashExit=$LASTEXITCODE
if ($flashExit -notin @(0,255)) { throw "Upgrade command returned $flashExit. Do not flash again; inspect the test VM and $output" }
Write-Host 'The upgrade command disconnected or returned. Successful boot/version is not yet verified.'
Write-Host 'Allow at least five minutes. If VirtualBox stalls in UEFI, inspect the console before taking any recovery action.'
Write-Host 'When the router is back, run: powershell.exe -NoProfile -ExecutionPolicy Bypass -File C:\moci-build\MoCI\scripts\Test-MoCI-Upgrade.ps1 -VerifyOnly'
Write-Host "Recovery snapshot: $snapshot. Reports and private backup: $output"
