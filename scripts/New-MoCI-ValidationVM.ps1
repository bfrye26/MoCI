#Requires -Version 5.1
[CmdletBinding()]
param([string]$RouterAddress = '192.168.50.1')
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$parsedAddress = $null
if (-not [System.Net.IPAddress]::TryParse($RouterAddress, [ref]$parsedAddress)) { throw 'RouterAddress must be an IP address.' }
$vbox = 'C:\Program Files\Oracle\VirtualBox\VBoxManage.exe'
if (-not (Test-Path -LiteralPath $vbox -PathType Leaf)) { throw 'VirtualBox command-line tools were not found.' }
$sourceId = '3164c3c8-a30a-4171-99ec-a4fc4bda96dd'
$cloneId = [guid]::NewGuid().ToString()
$name = 'MoCI-Release-Test-' + [DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss')
$base = 'C:\moci-build\validation-vms'
$destination = Join-Path $base $name
if (Test-Path -LiteralPath $destination) { throw "Destination already exists: $destination" }

function Get-VMInfo([string]$Id) {
    $lines = @(& $vbox showvminfo $Id --machinereadable)
    if ($LASTEXITCODE -ne 0) { throw "VirtualBox could not read VM $Id. No forced shutdown will be attempted." }
    $values = @{}
    foreach ($line in $lines) {
        if ($line -match '^([^=]+)="(.*)"$') { $values[$matches[1].Trim('"')] = $matches[2] }
    }
    return $values
}

$info = Get-VMInfo $sourceId
if ($info['name'] -ne 'MoCI3') { throw 'The source VM identity does not match MoCI3.' }
if ($info['VMState'] -notin @('running','poweroff')) { throw "Source must be running or powered off, not $($info['VMState'])." }
if ($info['macaddress1'] -notmatch '^[0-9A-Fa-f]{12}$') { throw 'Could not verify source LAN MAC address.' }
# Check disk space before interrupting the working VM. Full clones copy disks.
$configuration = $info['CfgFile']
if (-not $configuration) { throw 'Source configuration path was not returned.' }
[xml]$machineXml = [System.IO.File]::ReadAllText($configuration)
$sourceFolder = Split-Path -Parent $configuration
$diskBytes = [int64]0
foreach ($disk in $machineXml.GetElementsByTagName('HardDisk')) {
    $location = [string]$disk.GetAttribute('location')
    if (-not $location) { continue }
    if (-not [System.IO.Path]::IsPathRooted($location)) { $location = Join-Path $sourceFolder $location }
    if (Test-Path -LiteralPath $location -PathType Leaf) { $diskBytes += (Get-Item -LiteralPath $location).Length }
}
if ($diskBytes -le 0) { throw 'Could not determine source disk size. No VM changes were made.' }
$needed = [int64]($diskBytes * 1.15) + 2GB
if ((Get-PSDrive C).Free -lt $needed) { throw "Not enough free space for a full clone. At least $([math]::Ceiling($needed / 1GB)) GB is required." }
New-Item -ItemType Directory -Path $base -Force | Out-Null

if ($info['VMState'] -eq 'running') {
    $mac = ($info['macaddress1'] -replace '(..)(?!$)', '$1:').ToLowerInvariant()
    Write-Host 'Gracefully shutting down MoCI3 after verifying its LAN MAC. No forced power-off is used.'
    # The generated MAC is strictly hex; no user-supplied shell fragment is used.
    & ssh -o ConnectTimeout=10 -o ConnectionAttempts=1 "root@$RouterAddress" "grep -qi '^$mac`$' /sys/class/net/*/address && sync && poweroff"
    $shutdownExit = $LASTEXITCODE
    if ($shutdownExit -notin @(0,255)) { throw 'Guest shutdown command failed. The VM was not forcibly stopped.' }
    $deadline = [DateTime]::UtcNow.AddSeconds(120)
    do {
        $info = Get-VMInfo $sourceId
        if ($info['VMState'] -eq 'poweroff') { break }
        if ($info['VMState'] -notin @('running','stopping')) { throw "Unexpected source state $($info['VMState']); inspect VirtualBox before continuing." }
        Start-Sleep -Seconds 2
    } while ([DateTime]::UtcNow -lt $deadline)
    if ($info['VMState'] -ne 'poweroff') { throw 'MoCI3 did not shut down within two minutes. No clone was started.' }
}

Write-Host "Creating full test copy: $name"
& $vbox clonevm $sourceId --name $name --uuid $cloneId --basefolder $base --mode machine --options keepallmacs --register
if ($LASTEXITCODE -ne 0) { throw "Clone failed. MoCI3 remains powered off and preserved. Inspect $destination before retrying." }
$clone = Get-VMInfo $cloneId
if ($clone['VMState'] -ne 'poweroff' -or $clone['macaddress1'] -ne $info['macaddress1']) { throw 'Clone state or LAN MAC verification failed. It has not been started.' }
& $vbox snapshot $cloneId take 'before-release-validation' --description 'Powered-off full clone before restore and upgrade tests'
if ($LASTEXITCODE -ne 0) { throw 'Could not create recovery snapshot. Test VM has not been started.' }
if ((Get-VMInfo $sourceId)['VMState'] -ne 'poweroff') { throw 'MoCI3 is running again. Test VM will not start with a duplicate LAN address.' }
$record = [ordered]@{name=$name; uuid=$cloneId; source_uuid=$sourceId; directory=$destination; baseline_snapshot='before-release-validation'; source_must_remain_powered_off=$true}
$project = Split-Path -Parent $PSScriptRoot
$recordDirectory = Join-Path $project 'artifacts\validation-vm'
New-Item -ItemType Directory -Path $recordDirectory -Force | Out-Null
$recordPath = Join-Path $recordDirectory ($name + '.json')
$record | ConvertTo-Json | Set-Content -LiteralPath $recordPath -Encoding UTF8
& $vbox startvm $cloneId --type gui
if ($LASTEXITCODE -ne 0) { throw "Test VM was created but did not start. Details: $recordPath" }
Write-Host "Test VM started: $name"
Write-Host "Details: $recordPath"
Write-Host 'Keep MoCI3 powered off while this test VM runs. Both use 192.168.50.1 and the same MAC addresses.'
Write-Host 'No firmware was flashed and no settings were restored. Open https://192.168.50.1/moci/ after boot.'
