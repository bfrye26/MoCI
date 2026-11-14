#Requires -Version 5.1
[CmdletBinding()]
param([string]$RouterAddress='192.168.50.1')
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
$source=Get-VMInfo $sourceId
$clone=Get-VMInfo $cloneId
if ($source['VMState'] -ne 'poweroff' -or $clone['VMState'] -ne 'running' -or $clone['name'] -ne 'MoCI-Release-Test-20261113-124935' -or $clone['hardwareuuid'] -ne $cloneId) { throw 'Original MoCI3 must be off and the recorded disposable test VM running with its expected hardware UUID.' }
if ($clone['IDE-1-0'] -ne 'emptydrive') { throw 'Expected an empty IDE DVD drive. Inspect the existing attachment before changing recovery media.' }
if ((Get-PSDrive C).Free -lt 3GB) { throw 'At least 3 GB of host disk space is required.' }
$originalIso='C:\moci-build\ship-8cd226c8b7b8-20261113T170016Z\installer\MoCI-x86-64-UEFI-Installer-UNTESTED.iso'
if ((Get-FileHash -LiteralPath $originalIso -Algorithm SHA256).Hash.ToLowerInvariant() -ne '45e8181b1b9fa04636cf268bd2d22abea53ffeded7b40b5b5c74de9e560ad082') { throw 'Installer ISO checksum mismatch. No VM changes made.' }
$name='storage-recovery-'+[DateTime]::UtcNow.ToString('yyyyMMddTHHmmssZ')+'-'+[guid]::NewGuid().ToString('N').Substring(0,8)
$output=Join-Path $project ('artifacts\'+$name)
New-Item -ItemType Directory -Path $output | Out-Null
$iso=Join-Path $output 'MoCI-Storage-Recovery.iso'
$payload=[Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes([System.IO.File]::ReadAllText((Join-Path $PSScriptRoot 'moci-offline-root-repair.sh')).Replace("`r`n","`n")))
$linuxHelper='/tmp/moci-offline-root-'+[guid]::NewGuid().ToString('N')+'.sh'
$payload | & wsl.exe -d Ubuntu-24.04 --exec bash -c "umask 077; tr -d '\r\n' | base64 -d > '$linuxHelper'"
if ($LASTEXITCODE -ne 0) { throw 'Could not stage recovery helper in Ubuntu. No VM changes made.' }
$linuxIso='/mnt/c/moci-build/MoCI/artifacts/'+$name+'/MoCI-Storage-Recovery.iso'
Write-Host 'Adding the offline repair helper to a copy of the verified installer ISO.'
& wsl.exe -d Ubuntu-24.04 --exec xorriso -indev /mnt/c/moci-build/ship-8cd226c8b7b8-20261113T170016Z/installer/MoCI-x86-64-UEFI-Installer-UNTESTED.iso -outdev $linuxIso -boot_image any replay -map $linuxHelper /moci-offline-repair.sh
if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $iso)) { throw 'Recovery ISO creation failed. No VM changes made.' }
$remote="root@$RouterAddress"
$identityScript=Join-Path $PSScriptRoot 'router-restore-check.py'
& scp -O $identityScript "${remote}:/tmp/moci-storage-recovery-identity.py"
if ($LASTEXITCODE -ne 0) { throw 'Could not stage remote identity check.' }
& ssh $remote "python3 /tmp/moci-storage-recovery-identity.py --verify-identity-only --expect-hardware-uuid '$cloneId' && sync && poweroff"
if ($LASTEXITCODE -notin @(0,255)) { throw 'Guest shutdown failed. No forced shutdown is attempted.' }
$deadline=[DateTime]::UtcNow.AddSeconds(120)
do {
    $clone=Get-VMInfo $cloneId
    if ($clone['VMState'] -eq 'poweroff') { break }
    Start-Sleep -Seconds 2
} while ([DateTime]::UtcNow -lt $deadline)
if ($clone['VMState'] -ne 'poweroff' -or (Get-VMInfo $sourceId)['VMState'] -ne 'poweroff') { throw 'Both VMs must be off before recovery media is attached. No forced shutdown attempted.' }
$snapshot='before-offline-root-repair-'+[DateTime]::UtcNow.ToString('yyyyMMddTHHmmssZ')
& $vbox snapshot $cloneId take $snapshot --description 'Powered-off recovery point before offline ext4 repair'
if ($LASTEXITCODE -ne 0) { throw 'Recovery snapshot failed. No repair started.' }
$state=@{test_vm=$cloneId;snapshot=$snapshot;iso=$iso;original_iso='none';release_ready=$false;repair_verified=$false}
$state | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $output 'recovery-state.json') -Encoding UTF8
& $vbox storageattach $cloneId --storagectl IDE --port 1 --device 0 --type dvddrive --medium $iso
if ($LASTEXITCODE -ne 0) { throw 'Could not attach recovery ISO. Test VM remains off.' }
& $vbox modifyvm $cloneId --boot1 dvd --boot2 disk
if ($LASTEXITCODE -ne 0) { throw 'Could not set recovery boot order. Test VM remains off.' }
& $vbox startvm $cloneId --type gui
if ($LASTEXITCODE -ne 0) { throw 'Could not start recovery VM.' }
Write-Host 'In the VM, boot the live system and choose Quit in the installer menu. Do not choose Install.'
Write-Host 'At the live shell, run: sudo bash /run/live/medium/moci-offline-repair.sh'
Write-Host 'If it prints PASS, run: sudo poweroff'
Write-Host 'Then run Complete-MoCI-Storage-Recovery.ps1 in Windows. No firmware was flashed.'
Write-Host "Recovery record: $output\recovery-state.json"
