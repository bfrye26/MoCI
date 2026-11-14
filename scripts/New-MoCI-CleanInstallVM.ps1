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
$upgradeId='97b3d07b-5b50-4662-9d1e-86f3fa22a857'
function Get-VMInfo([string]$Id) {
    $lines=@(& $vbox showvminfo $Id --machinereadable)
    if ($LASTEXITCODE -ne 0) { throw "Cannot inspect VM $Id" }
    $values=@{}
    foreach ($line in $lines) { if ($line -match '^([^=]+)="(.*)"$') { $values[$matches[1].Trim('"')]=$matches[2] } }
    return $values
}
function Invoke-VBox([string[]]$Arguments) {
    & $vbox @Arguments
    if ($LASTEXITCODE -ne 0) { throw 'VirtualBox setup failed. Created files/VM are preserved for inspection; no automatic delete or retry is performed.' }
}
$original=Get-VMInfo $sourceId
$upgrade=Get-VMInfo $upgradeId
if ($original['VMState'] -ne 'poweroff' -or $upgrade['VMState'] -notin @('running','poweroff') -or $upgrade['hardwareuuid'] -ne $upgradeId -or $upgrade['name'] -ne 'MoCI-Release-Test-20261113-124935') { throw 'Unexpected lab VM identity/state. MoCI3 must remain off.' }
if ($upgrade['nic1'] -ne 'hostonly' -or $upgrade['nic2'] -ne 'nat' -or -not $upgrade['hostonlyadapter1']) { throw 'Expected host-only LAN on adapter 1 and NAT WAN on adapter 2.' }
$hostOnly=$upgrade['hostonlyadapter1']
$running=@(& $vbox list runningvms)
if ($LASTEXITCODE -ne 0) { throw 'Cannot inspect running VMs.' }
foreach ($line in $running) {
    if ($line -match '^"(MoCI[^\"]*)"\s+\{([^}]+)\}$' -and $matches[2] -ne $upgradeId) { throw "Another MoCI VM is running: $($matches[1]). Stop it before creating this lab router." }
}
if ((Get-PSDrive C).Free -lt 20GB) { throw 'At least 20 GB of host disk space is required.' }
$build='C:\moci-build\ship-77ac51bf9c72-20261113T185130Z'
$image=Join-Path $build 'openwrt-x86-64-generic-ext4-combined-efi.img.gz'
$iso=Join-Path $build 'installer\MoCI-x86-64-UEFI-Installer-UNTESTED.iso'
$imageHash='d68a89a508f9c5441ab0cbce9d1c840ef59525062bfa550348e32835606e3de0'
$isoHash='7893e733f0be365ad3ce77109513912d7aed1b92799312976d7695a2c1c485e6'
if ((Get-FileHash -LiteralPath $image -Algorithm SHA256).Hash.ToLowerInvariant() -ne $imageHash -or (Get-FileHash -LiteralPath $iso -Algorithm SHA256).Hash.ToLowerInvariant() -ne $isoHash) { throw 'rc.5 firmware or installer checksum mismatch. No VM changes made.' }
$id=[guid]::NewGuid().ToString()
$name='MoCI-Clean-Install-'+[DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss')
$base='C:\moci-build\validation-vms'
$folder=Join-Path $base $name
if (Test-Path -LiteralPath $folder) { throw 'New VM directory already exists; nothing overwritten.' }
$records=Join-Path $project 'artifacts\clean-install-vm'
New-Item -ItemType Directory -Path $records -Force | Out-Null
$recordFile=Join-Path $records ($name+'.json')
$state=[ordered]@{schema=1;uuid=$id;name=$name;folder=$folder;source_vm=$sourceId;preserved_upgrade_vm=$upgradeId;disk_bytes=[int64]64GB;iso=$iso;iso_sha256=$isoHash;image_sha256=$imageHash;release_ready=$false;status='PREPARING'}
$state | ConvertTo-Json | Set-Content -LiteralPath $recordFile -Encoding UTF8
# Only a new virtual disk is created. No existing disk is attached to this VM.
Invoke-VBox @('createvm','--name',$name,'--uuid',$id,'--platform-architecture','x86','--ostype','Debian_64','--basefolder',$base,'--register')
Invoke-VBox @('modifyvm',$id,'--firmware','efi','--memory','4096','--cpus','2','--ioapic','on','--paravirt-provider','none','--x86-x2apic','off','--apic','on','--x86-pae','on','--graphicscontroller','vmsvga','--vram','32','--boot1','dvd','--boot2','disk','--nic1','hostonly','--host-only-adapter1',$hostOnly,'--nic2','nat','--nic-type1','82540EM','--nic-type2','82540EM','--cable-connected1','on','--cable-connected2','on')
$disk=Join-Path $folder 'blank-64GiB.vdi'
Invoke-VBox @('createmedium','disk','--filename',$disk,'--size','65536','--format','VDI','--variant','Standard')
Invoke-VBox @('storagectl',$id,'--name','SATA','--add','sata','--controller','IntelAHCI','--portcount','2','--bootable','on')
Invoke-VBox @('storageattach',$id,'--storagectl','SATA','--port','0','--device','0','--type','hdd','--medium',$disk,'--nonrotational','on')
Invoke-VBox @('storageattach',$id,'--storagectl','SATA','--port','1','--device','0','--type','dvddrive','--medium',$iso)
$fresh=Get-VMInfo $id
if ($fresh['VMState'] -ne 'poweroff' -or -not $fresh['hardwareuuid'] -or $fresh['hardwareuuid'] -in @($sourceId,$upgradeId) -or $fresh['macaddress1'] -notmatch '^[0-9a-f]{12}$' -or $fresh['macaddress2'] -notmatch '^[0-9a-f]{12}$') { throw 'Could not verify the new VM identity/MACs.' }
$state['hardware_uuid']=$fresh['hardwareuuid'];$state['lan_mac']=$fresh['macaddress1'];$state['wan_mac']=$fresh['macaddress2'];$state['disk']=$disk
$state['status']='CREATED_OFF'
$state | ConvertTo-Json | Set-Content -LiteralPath $recordFile -Encoding UTF8
if ($upgrade['VMState'] -eq 'running') {
    $remote="root@$RouterAddress"
    & scp -O (Join-Path $PSScriptRoot 'router-restore-check.py') "${remote}:/tmp/moci-cleaninstall-identity.py"
    if ($LASTEXITCODE -ne 0) { throw 'Cannot stage identity check. New VM remains off.' }
    Write-Host 'Preserving the upgrade-test VM and requesting a clean shutdown to avoid duplicate router IPs.'
    & ssh $remote "python3 /tmp/moci-cleaninstall-identity.py --verify-identity-only --expect-hardware-uuid '$upgradeId' && sync && poweroff"
    if ($LASTEXITCODE -notin @(0,255)) { throw 'Guest shutdown request failed. New VM remains off; no forced shutdown attempted.' }
    $deadline=[DateTime]::UtcNow.AddSeconds(120)
    do {
        $upgrade=Get-VMInfo $upgradeId
        if ($upgrade['VMState'] -eq 'poweroff') { break }
        Start-Sleep -Seconds 2
    } while ([DateTime]::UtcNow -lt $deadline)
}
if ((Get-VMInfo $sourceId)['VMState'] -ne 'poweroff' -or (Get-VMInfo $upgradeId)['VMState'] -ne 'poweroff') { throw 'Both existing router VMs must be off. New VM remains off.' }
Invoke-VBox @('startvm',$id,'--type','gui')
$state['status']='LIVE_INSTALLER_STARTED'
$state | ConvertTo-Json | Set-Content -LiteralPath $recordFile -Encoding UTF8
$lan=($fresh['macaddress1'] -replace '(..)(?!$)','$1:').ToLowerInvariant()
$wan=($fresh['macaddress2'] -replace '(..)(?!$)','$1:').ToLowerInvariant()
Write-Host "New installer VM: $name"
Write-Host 'Select its single blank 64 GiB disk as the destination.'
Write-Host "WAN/uplink MAC: $wan (adapter 2, NAT)"
Write-Host "LAN/client MAC: $lan (adapter 1, host-only)"
Write-Host 'Keep LAN IP 192.168.50.1, choose a hostname, set your root password, then select Install.'
Write-Host 'After installation completes, choose Quit and run sudo poweroff in the live shell.'
Write-Host 'Then run Complete-MoCI-CleanInstall.ps1 in Windows to eject the ISO and boot the installed disk.'
Write-Host "Record: $recordFile"
