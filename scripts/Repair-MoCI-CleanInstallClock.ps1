#Requires -Version 5.1
[CmdletBinding()]
param([switch]$RecoverStalledBoot)
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
if ($id -in @('3164c3c8-a30a-4171-99ec-a4fc4bda96dd','97b3d07b-5b50-4662-9d1e-86f3fa22a857') -or $state.name -notlike 'MoCI-Clean-Install-*' -or $state.status -ne 'INSTALLED_DISK_BOOT_REQUESTED' -or $state.image_sha256 -ne 'd68a89a508f9c5441ab0cbce9d1c840ef59525062bfa550348e32835606e3de0') { throw 'This helper accepts only the recorded installed rc.5 clean-test VM.' }
function Assert-Target([string]$ExpectedState) {
    foreach ($other in @('3164c3c8-a30a-4171-99ec-a4fc4bda96dd','97b3d07b-5b50-4662-9d1e-86f3fa22a857')) { if ((Get-VMInfo $other)['VMState'] -ne 'poweroff') { throw 'Both preserved router VMs must remain off.' } }
    $fresh=Get-VMInfo $id
    if ($fresh['name'] -ne $state.name -or $fresh['hardwareuuid'] -ne $state.hardware_uuid -or $fresh['VMState'] -ne $ExpectedState) { throw 'Fresh VM identity/state changed. No further recovery action permitted.' }
}
function Invoke-UnlockedVBox([string[]]$Arguments) {
    $deadline=[DateTime]::UtcNow.AddSeconds(60)
    do {
        Assert-Target 'poweroff'
        $previousPreference=$ErrorActionPreference
        try { $ErrorActionPreference='Continue';$detail=@(& $vbox @Arguments 2>&1);$code=$LASTEXITCODE } finally { $ErrorActionPreference=$previousPreference }
        if ($code -eq 0) { return }
        if (($detail -join ' ') -notmatch 'already locked by a session|being locked or unlocked') { throw ('VirtualBox clock recovery failed: '+($detail -join ' ')) }
        if ([DateTime]::UtcNow -ge $deadline) { throw 'VirtualBox session did not unlock. VM is off; preserve the recovery snapshot and inspect before retrying.' }
        Start-Sleep -Seconds 3
    } while ($true)
}
$fresh=Get-VMInfo $id
if ($fresh['VMState'] -notin @('running','poweroff')) { throw "Unsupported recovery state: $($fresh['VMState'])." }
Assert-Target $fresh['VMState']
if ((Get-PSDrive C).Free -lt 12GB) { throw 'At least 12 GB free on C: is required for a recovery snapshot.' }
$output=Join-Path $project ('artifacts\clock-recovery-'+[DateTime]::UtcNow.ToString('yyyyMMddTHHmmssZ')+'-'+[guid]::NewGuid().ToString('N').Substring(0,8))
New-Item -ItemType Directory -Path $output | Out-Null
Copy-Item -LiteralPath $fresh['CfgFile'] -Destination (Join-Path $output 'vm-settings.before.vbox')
$log=Join-Path $state.folder 'Logs\VBox.log'
if (Test-Path -LiteralPath $log) { Copy-Item -LiteralPath $log -Destination (Join-Path $output 'VBox.before.log') }
$snapshot='before-clock-compatibility-'+[DateTime]::UtcNow.ToString('yyyyMMddTHHmmssZ')
Write-Host 'Creating a recovery snapshot before changing the fresh test VM. Existing router VMs remain off.'
& $vbox snapshot $id take $snapshot --description 'Fresh rc.5 VM before KVM clock/APIC compatibility change'
if ($LASTEXITCODE -ne 0) { throw 'Recovery snapshot failed. No shutdown or clock changes attempted.' }
$result=[ordered]@{schema=1;vm=$id;snapshot=$snapshot;snapshot_confirmed=$true;forced_poweroff=$false;restart_requested=$false;release_ready=$false}
$result | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $output 'recovery-state.json') -Encoding UTF8
if ($fresh['VMState'] -eq 'running') {
    Assert-Target 'running'
    Write-Host 'Requesting ACPI shutdown of the fresh test VM.'
    & $vbox controlvm $id acpipowerbutton
    if ($LASTEXITCODE -ne 0) { throw 'ACPI shutdown request failed. No forced shutdown attempted.' }
    $deadline=[DateTime]::UtcNow.AddSeconds(60)
    do {
        $fresh=Get-VMInfo $id
        if ($fresh['VMState'] -eq 'poweroff') { break }
        Start-Sleep -Seconds 2
    } while ([DateTime]::UtcNow -lt $deadline)
    if ($fresh['VMState'] -ne 'poweroff') {
        if (-not $RecoverStalledBoot) { throw "The guest did not shut down. Snapshot preserved: $snapshot. Use -RecoverStalledBoot only to recover this stalled boot." }
        Assert-Target 'running'
        Write-Host 'Guest did not respond. Recovery snapshot is confirmed; powering off only the stalled fresh test VM.'
        & $vbox controlvm $id poweroff
        if ($LASTEXITCODE -ne 0) { throw 'Could not power off the stalled test VM. No clock change attempted.' }
        $result['forced_poweroff']=$true
        $result | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $output 'recovery-state.json') -Encoding UTF8
    }
}
Assert-Target 'poweroff'
# Match the tested router's provider and APIC/PAE settings. Disk contents and
# Windows Hyper-V/WSL/security settings are not modified by this command.
Invoke-UnlockedVBox @('modifyvm',$id,'--paravirt-provider','none','--x86-x2apic','off','--x86-pae','on')
$state | Add-Member -NotePropertyName clock_compatibility -NotePropertyValue 'paravirt-none-x2apic-off-pae-on' -Force
$state | ConvertTo-Json | Set-Content -LiteralPath $recordFile.FullName -Encoding UTF8
Invoke-UnlockedVBox @('startvm',$id,'--type','gui')
$result['restart_requested']=$true
$result | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $output 'recovery-state.json') -Encoding UTF8
Write-Host 'Started the existing installed disk with the clock compatibility settings. No firmware was reflashed.'
Write-Host "Recovery snapshot: $snapshot. Results: $output"
Write-Host 'Once the dashboard is reachable, run Test-MoCI-CleanInstall.ps1. Startup and fresh-install validation remain pending.'
