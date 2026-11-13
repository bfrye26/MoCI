#Requires -Version 5.1
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$vbox='C:\Program Files\Oracle\VirtualBox\VBoxManage.exe'
$cloneId='97b3d07b-5b50-4662-9d1e-86f3fa22a857'
foreach ($id in @('3164c3c8-a30a-4171-99ec-a4fc4bda96dd',$cloneId)) {
    $info=@(& $vbox showvminfo $id --machinereadable)
    if ($LASTEXITCODE -ne 0 -or $info -notcontains 'VMState="poweroff"') { throw 'Both MoCI3 and the test VM must be powered off. No forced shutdown will be attempted.' }
}
& $vbox storageattach $cloneId --storagectl IDE --port 1 --device 0 --type dvddrive --medium none
if ($LASTEXITCODE -ne 0) { throw 'Could not eject recovery ISO.' }
& $vbox modifyvm $cloneId --boot1 disk --boot2 dvd
if ($LASTEXITCODE -ne 0) { throw 'Could not restore disk boot order.' }
& $vbox startvm $cloneId --type gui
if ($LASTEXITCODE -ne 0) { throw 'Could not start router VM.' }
Write-Host 'Router VM started from disk. Recovery is not yet marked passed.'
Write-Host 'Once management returns, run Test-MoCI-Upgrade.ps1 -VerifyOnly and retain its results as a manually repaired rc.4 test.'
