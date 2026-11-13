#Requires -Version 5.1
[CmdletBinding()]
param([string]$RouterAddress='192.168.50.1',[switch]$Resume)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$address=$null
if (-not [System.Net.IPAddress]::TryParse($RouterAddress,[ref]$address)) { throw 'RouterAddress must be an IP address.' }
$project=Split-Path -Parent $PSScriptRoot
$vbox='C:\Program Files\Oracle\VirtualBox\VBoxManage.exe'
$sourceId='3164c3c8-a30a-4171-99ec-a4fc4bda96dd'
$cloneId='97b3d07b-5b50-4662-9d1e-86f3fa22a857'
function Get-VMInfo([string]$Id) {
    $lines=@(& $vbox showvminfo $Id --machinereadable)
    if ($LASTEXITCODE -ne 0) { throw "Cannot inspect VM $Id" }
    $values=@{}
    foreach ($line in $lines) { if ($line -match '^([^=]+)="(.*)"$') { $values[$matches[1].Trim('"')]=$matches[2] } }
    return $values
}
function Assert-TestVM([string]$ExpectedState) {
    $source=Get-VMInfo $sourceId
    $clone=Get-VMInfo $cloneId
    if ($source['VMState'] -ne 'poweroff' -or $clone['VMState'] -ne $ExpectedState -or $clone['hardwareuuid'] -ne $cloneId -or $clone['name'] -ne 'MoCI-Release-Test-20261113-124935') { throw 'Unexpected VM state or identity. MoCI3 must remain off; no forced shutdown is attempted.' }
}
function Start-TestVM {
    $unlockDeadline=[DateTime]::UtcNow.AddSeconds(60)
    do {
        Assert-TestVM 'poweroff'
        $previousPreference=$ErrorActionPreference
        try {
            $ErrorActionPreference='Continue'
            $startOutput=@(& $vbox startvm $cloneId --type gui 2>&1)
            $startExit=$LASTEXITCODE
        } finally { $ErrorActionPreference=$previousPreference }
        if ($startExit -eq 0) { return }
        $detail=$startOutput -join [Environment]::NewLine
        if ($detail -notmatch 'already locked (?:by|for) a session|being (?:locked or )?unlocked') { throw "Could not cold-start the test VM: $detail" }
        if ([DateTime]::UtcNow -ge $unlockDeadline) { throw 'VirtualBox did not release its session lock within 60 seconds. Leave the VM off and retry this script with -Resume.' }
        Write-Host 'VirtualBox is releasing the previous GUI session; waiting before starting the powered-off test VM.'
        Start-Sleep -Seconds 3
    } while ($true)
}
if ($Resume) { Assert-TestVM 'poweroff' } else { Assert-TestVM 'running' }
# Refuse to reboot against an unverified, old or different image baseline.
$latest=Get-ChildItem -LiteralPath (Join-Path $project 'artifacts') -Directory -Filter 'upgrade-check-*' | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $latest) { throw 'Complete the rc.5 upgrade validation first.' }
$previous=Get-Content -LiteralPath (Join-Path $latest.FullName 'upgrade-post.json') -Raw | ConvertFrom-Json
$upgradeState=Get-Content -LiteralPath (Join-Path $latest.FullName 'upgrade-state.json') -Raw | ConvertFrom-Json
if (-not $previous.success -or $upgradeState.test_vm -ne $cloneId -or $upgradeState.image_sha256 -ne 'd68a89a508f9c5441ab0cbce9d1c840ef59525062bfa550348e32835606e3de0') { throw 'No successful matching rc.5 upgrade validation exists.' }
if ($Resume) {
    $pending=Get-ChildItem -LiteralPath (Join-Path $project 'artifacts') -Directory -Filter 'coldboot-check-*' | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if (-not $pending -or $pending.Name -notmatch '^coldboot-check-[0-9]{8}T[0-9]{6}Z-[0-9a-f]{8}$') { throw 'No interrupted cold-boot test exists.' }
    $name=$pending.Name
    $output=$pending.FullName
    if (Test-Path -LiteralPath (Join-Path $output 'coldboot-report.json')) { throw 'This cold-boot test already has a report. Start a new test without -Resume.' }
} else {
    $name='coldboot-check-'+[DateTime]::UtcNow.ToString('yyyyMMddTHHmmssZ')+'-'+[guid]::NewGuid().ToString('N').Substring(0,8)
    $output=Join-Path $project ('artifacts\'+$name)
    New-Item -ItemType Directory -Path $output | Out-Null
}
$stage='/root/'+$name
$remote="root@$RouterAddress"
if (-not $Resume) {
& ssh -o ConnectTimeout=10 -o ConnectionAttempts=1 $remote "mkdir -m 700 '$stage'"
if ($LASTEXITCODE -ne 0) { throw 'Could not stage the cold-boot test. No shutdown started.' }
& scp -O (Join-Path $PSScriptRoot 'router-restore-check.py') "${remote}:$stage/"
if ($LASTEXITCODE -ne 0) { throw 'Could not upload identity check. No shutdown started.' }
Write-Host 'Checking the disposable VM identity, recording its boot ID, then requesting a clean power-off.'
& ssh $remote "python3 '$stage/router-restore-check.py' --verify-identity-only --expect-hardware-uuid '$cloneId' && cat /proc/sys/kernel/random/boot_id > '$stage/boot-id.before' && sync && poweroff"
if ($LASTEXITCODE -notin @(0,255)) { throw 'Clean shutdown request failed. No forced power-off will be attempted.' }
$deadline=[DateTime]::UtcNow.AddSeconds(120)
do {
    $info=Get-VMInfo $cloneId
    if ($info['VMState'] -eq 'poweroff') { break }
    if ($info['VMState'] -notin @('running','stopping')) { throw "Unexpected VM shutdown state: $($info['VMState']). Inspect the console." }
    Start-Sleep -Seconds 2
} while ([DateTime]::UtcNow -lt $deadline)
}
Assert-TestVM 'poweroff'
@{schema=1;test_vm=$cloneId;poweroff_confirmed=$true;resumed=[bool]$Resume;image_sha256=$upgradeState.image_sha256;success=$false;release_ready=$false} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $output 'coldboot-state.json') -Encoding UTF8
Write-Host 'Power-off confirmed. Starting the disposable VM from its installed disk.'
Start-TestVM
# Existing verification waits for SSH and performs read-only storage checks.
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'Test-MoCI-Upgrade.ps1') -RouterAddress $RouterAddress -VerifyOnly
if ($LASTEXITCODE -ne 0) { throw "Cold-boot router/client checks failed. No firmware was flashed or repaired. Results: $output" }
Assert-TestVM 'running'
& ssh $remote "python3 '$stage/router-restore-check.py' --verify-identity-only --expect-hardware-uuid '$cloneId' && cat /proc/sys/kernel/random/boot_id > '$stage/boot-id.after' && ! cmp -s '$stage/boot-id.before' '$stage/boot-id.after'"
if ($LASTEXITCODE -ne 0) { throw 'Could not confirm a changed guest boot ID on the expected VM.' }
foreach ($file in @('boot-id.before','boot-id.after')) {
    & scp -O "${remote}:$stage/$file" (Join-Path $output $file)
    if ($LASTEXITCODE -ne 0) { throw "Could not retrieve $file" }
}
$before=(Get-Content -LiteralPath (Join-Path $output 'boot-id.before') -Raw).Trim()
$after=(Get-Content -LiteralPath (Join-Path $output 'boot-id.after') -Raw).Trim()
if ([guid]$before -eq [guid]$after) { throw 'Guest boot ID did not change.' }
Copy-Item -LiteralPath (Join-Path $latest.FullName 'upgrade-post.json') -Destination (Join-Path $output 'post-boot-checks.json')
@{schema=1;success=$true;release_ready=$false;test_vm=$cloneId;before_boot_id=$before;after_boot_id=$after;poweroff_confirmed=$true;router_client_storage_checks='PASS';physical_hardware='NOT_TESTED';wan_isolation='NOT_TESTED'} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $output 'coldboot-report.json') -Encoding UTF8
Write-Host "PASS: clean power-off, cold start, changed boot ID and post-boot rc.5 router/client/storage checks. Report: $output\coldboot-report.json"
Write-Host 'External WAN isolation, firewall traffic tests, clean installer validation and physical hardware remain release gates.'
