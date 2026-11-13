#Requires -Version 5.1
[CmdletBinding()]
param([string]$RouterAddress='192.168.50.1')
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$address=$null
if (-not [System.Net.IPAddress]::TryParse($RouterAddress,[ref]$address)) { throw 'RouterAddress must be an IP address.' }
$project=Split-Path -Parent $PSScriptRoot
$vbox='C:\Program Files\Oracle\VirtualBox\VBoxManage.exe'
function Get-VMInfo([string]$Id) {
    $lines=@(& $vbox showvminfo $Id --machinereadable)
    if ($LASTEXITCODE -ne 0) { throw "Cannot inspect VM $Id" }
    $values=@{}
    foreach ($line in $lines) { if ($line -match '^([^=]+)="(.*)"$') { $values[$matches[1].Trim('"')]=$matches[2] } }
    return $values
}
function Test-InstallerMediaDetached([hashtable]$Info) {
    if ($Info.ContainsKey('SATA-1-0')) { return $Info['SATA-1-0'] -in @('emptydrive','none') }
    # Some VBox versions omit unattached slots. Confirm current XML, excluding snapshots.
    if (-not $Info['CfgFile']) { return $false }
    try {
        [xml]$configuration=[IO.File]::ReadAllText($Info['CfgFile'])
        $machine=$configuration.SelectSingleNode('/*[local-name()="VirtualBox"]/*[local-name()="Machine"]')
        if (-not $machine) { return $false }
        $images=$machine.SelectNodes('.//*[local-name()="StorageController" and not(ancestor::*[local-name()="Snapshot"])]/*[local-name()="AttachedDevice" and @type="DVD"]/*[local-name()="Image"]')
        return $images.Count -eq 0
    } catch { return $false }
}
$records=Join-Path $project 'artifacts\clean-install-vm'
$recordFile=Get-ChildItem -LiteralPath $records -File -Filter 'MoCI-Clean-Install-*.json' | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $recordFile) { throw 'No clean-install VM record exists.' }
$state=Get-Content -LiteralPath $recordFile.FullName -Raw | ConvertFrom-Json
$id=([guid]$state.uuid).ToString()
$hardwareId=([guid]$state.hardware_uuid).ToString()
if ($id -in @('3164c3c8-a30a-4171-99ec-a4fc4bda96dd','97b3d07b-5b50-4662-9d1e-86f3fa22a857') -or $state.name -notlike 'MoCI-Clean-Install-*' -or $state.status -ne 'INSTALLED_DISK_BOOT_REQUESTED' -or $state.image_sha256 -ne 'd68a89a508f9c5441ab0cbce9d1c840ef59525062bfa550348e32835606e3de0' -or $state.disk_bytes -ne 64GB -or $state.lan_mac -notmatch '^[0-9a-f]{12}$' -or $state.wan_mac -notmatch '^[0-9a-f]{12}$') { throw 'Unexpected clean-install VM record.' }
foreach ($other in @('3164c3c8-a30a-4171-99ec-a4fc4bda96dd','97b3d07b-5b50-4662-9d1e-86f3fa22a857')) { if ((Get-VMInfo $other)['VMState'] -ne 'poweroff') { throw 'Both preserved router VMs must remain off.' } }
$fresh=Get-VMInfo $id
if ($fresh['VMState'] -ne 'running' -or $fresh['name'] -ne $state.name -or $fresh['hardwareuuid'] -ne $hardwareId) { throw "Fresh VM identity/state mismatch. State: $($fresh['VMState']); name: $($fresh['name']); hardware UUID: $($fresh['hardwareuuid'])." }
if (-not (Test-InstallerMediaDetached $fresh)) { throw "Installer media is still attached or its detached state cannot be verified. DVD slot: $($fresh['SATA-1-0'])." }
$name='cleaninstall-check-'+[DateTime]::UtcNow.ToString('yyyyMMddTHHmmssZ')+'-'+[guid]::NewGuid().ToString('N').Substring(0,8)
$output=Join-Path $project ('artifacts\'+$name)
New-Item -ItemType Directory -Path $output | Out-Null
$stage='/root/'+$name
$remote="root@$RouterAddress"
# Preserve both older VMs' trust entries. First connection asks for this VM's key.
$knownHosts=Join-Path $records ($id+'-known_hosts')
$sshOptions=@('-o',"UserKnownHostsFile=$knownHosts",'-o',"HostKeyAlias=moci-clean-$id",'-o','ConnectTimeout=10','-o','ConnectionAttempts=1')
Write-Host 'Validating the fresh VM. The first SSH connection asks to trust its new host key; previous VM trust entries are preserved.'
& ssh @sshOptions $remote "mkdir -m 700 '$stage'"
if ($LASTEXITCODE -ne 0) { throw 'Could not connect to the new router. No validation started.' }
# Legacy scp (-O) derives the remote basename by splitting on '/', so Windows
# backslash source paths would be stored under their full path. Use forward slashes.
$scripts=@('router-cleaninstall-check.py','router-upgrade-check.py','router-release-check.py','router-client-check.py') | ForEach-Object { (Join-Path $PSScriptRoot $_) -replace '\\','/' }
& scp -O @sshOptions @scripts "${remote}:$stage/"
if ($LASTEXITCODE -ne 0) { throw 'Could not upload validation scripts.' }
Write-Host 'Checking installed defaults and fresh storage. Tests may pull BusyBox and create temporary container/LAN clients; they apply no repairs.'
& ssh @sshOptions -o ServerAliveInterval=10 -o ServerAliveCountMax=3 $remote "python3 '$stage/router-cleaninstall-check.py' --expect-hardware-uuid '$hardwareId' --expect-lan-mac '$($state.lan_mac)' --expect-wan-mac '$($state.wan_mac)' --expect-disk-bytes '$($state.disk_bytes)'"
$verifyExit=$LASTEXITCODE
& scp -O @sshOptions "${remote}:$stage/cleaninstall-report.json" (Join-Path $output 'cleaninstall-report.json')
if ($LASTEXITCODE -ne 0) { throw "Could not retrieve the fresh-install report. No pass recorded. Inspect $output and the VM." }
$report=Get-Content -LiteralPath (Join-Path $output 'cleaninstall-report.json') -Raw | ConvertFrom-Json
if ($verifyExit -ne 0 -or -not $report.success) { throw "Fresh-install validation failed. No repairs were applied. Read $output\cleaninstall-report.json" }
foreach ($file in @('report.json','client-report.json','configuration-backup.tar.gz','backup-sha256.txt')) {
    & scp -O @sshOptions "${remote}:$stage/$file" (Join-Path $output $file)
    if ($LASTEXITCODE -ne 0) { throw "Could not retrieve $file. Results: $output" }
}
$expected=(Get-Content -LiteralPath (Join-Path $output 'backup-sha256.txt') -Raw).Trim()
if ((Get-FileHash -LiteralPath (Join-Path $output 'configuration-backup.tar.gz') -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expected) { throw 'Fresh-install backup download checksum mismatch.' }
$state | Add-Member -NotePropertyName validation_report -NotePropertyValue (Join-Path $output 'cleaninstall-report.json') -Force
$state | Add-Member -NotePropertyName cleaninstall_checks_passed -NotePropertyValue $true -Force
$state | ConvertTo-Json | Set-Content -LiteralPath $recordFile.FullName -Encoding UTF8
Write-Host "PASS: fresh rc.5 installation, full disk capacity, adapter mapping, default Docker and router/client connectivity. Results: $output"
Write-Host 'The downloaded settings backup is private. WAN isolation, firewall traffic controls and physical hardware remain release gates.'
