#Requires -Version 5.1
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$vbox='C:\Program Files\Oracle\VirtualBox\VBoxManage.exe'
$project=Split-Path -Parent $PSScriptRoot
function Get-VMInfo([string]$Id) {
    $lines=@(& $vbox showvminfo $Id --machinereadable)
    if ($LASTEXITCODE -ne 0) { throw "Cannot inspect VM $Id" }
    $values=@{}
    foreach ($line in $lines) { if ($line -match '^([^=]+)="(.*)"$') { $values[$matches[1].Trim('"')]=$matches[2] } }
    return $values
}
$recordFile=Get-ChildItem -LiteralPath (Join-Path $project 'artifacts\clean-install-vm') -File -Filter 'MoCI-Clean-Install-*.json' | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $recordFile) { throw 'No clean-install VM record exists.' }
$state=Get-Content -LiteralPath $recordFile.FullName -Raw | ConvertFrom-Json
$id=([guid]$state.uuid).ToString()
if ($id -in @('3164c3c8-a30a-4171-99ec-a4fc4bda96dd','97b3d07b-5b50-4662-9d1e-86f3fa22a857') -or $state.name -notlike 'MoCI-Clean-Install-*' -or $state.image_sha256 -ne 'd68a89a508f9c5441ab0cbce9d1c840ef59525062bfa550348e32835606e3de0') { throw 'Invalid clean-install VM record.' }
function Assert-InstallVMOff {
    foreach ($other in @('3164c3c8-a30a-4171-99ec-a4fc4bda96dd','97b3d07b-5b50-4662-9d1e-86f3fa22a857')) {
        if ((Get-VMInfo $other)['VMState'] -ne 'poweroff') { throw 'Both preserved router VMs must remain off.' }
    }
    $fresh=Get-VMInfo $id
    if ($fresh['VMState'] -ne 'poweroff' -or $fresh['name'] -ne $state.name -or $fresh['hardwareuuid'] -ne $state.hardware_uuid) { throw 'The recorded clean-install VM must be powered off with its expected identity. No forced shutdown attempted.' }
}
Assert-InstallVMOff
& $vbox storageattach $id --storagectl SATA --port 1 --device 0 --type dvddrive --medium emptydrive
if ($LASTEXITCODE -ne 0) { throw 'Could not eject the installer ISO.' }
& $vbox modifyvm $id --boot1 disk --boot2 dvd
if ($LASTEXITCODE -ne 0) { throw 'Could not set disk boot order.' }
$deadline=[DateTime]::UtcNow.AddSeconds(60)
do {
    Assert-InstallVMOff
    $previousPreference=$ErrorActionPreference
    try { $ErrorActionPreference='Continue';$detail=@(& $vbox startvm $id --type gui 2>&1);$startExit=$LASTEXITCODE } finally { $ErrorActionPreference=$previousPreference }
    if ($startExit -eq 0) { break }
    if (($detail -join ' ') -notmatch 'already locked by a session|being locked or unlocked') { throw ('VM start failed: '+($detail -join ' ')) }
    if ([DateTime]::UtcNow -ge $deadline) { throw 'VirtualBox session is still locked. Leave the VM off and retry this completion script.' }
    Start-Sleep -Seconds 3
} while ($true)
$state.status='INSTALLED_DISK_BOOT_REQUESTED'
$state | ConvertTo-Json | Set-Content -LiteralPath $recordFile.FullName -Encoding UTF8
Write-Host 'Started the clean-install VM from its disk. Open https://192.168.50.1/moci/ and sign in.'
Write-Host 'Installation and first-boot checks are still pending; this does not mark the firmware release-ready.'
