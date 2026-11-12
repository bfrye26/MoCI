#Requires -Version 5.1
[CmdletBinding()]
param(
    [ValidateSet('Firmware','All','Check')][string]$Mode='Firmware',
    [ValidateRange(1,64)][int]$Jobs=20,
    [string]$Distro='Ubuntu-24.04'
)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$wsl=(Get-Command wsl.exe -ErrorAction Stop).Source
$builder=Join-Path $PSScriptRoot 'build-ship-local.sh'
if (-not (Test-Path -LiteralPath $builder -PathType Leaf)) { throw "Missing companion script: $builder" }
$source=[System.IO.File]::ReadAllText($builder).Replace("`r`n","`n")
$payload=[Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($source))
$linuxPath='/tmp/moci-ship-'+[guid]::NewGuid().ToString('N')+'.sh'
Write-Host '[MoCI] Preparing the pinned local build in Ubuntu.'
# Base64 contains no shell metacharacters. Only a generated path enters the
# shell command; execution uses separate argv values and interactive stdin.
$payload | & $wsl -d $Distro --exec bash -c "umask 077; base64 -d > '$linuxPath'"
if ($LASTEXITCODE -ne 0) { throw "Could not stage builder in $Distro (exit $LASTEXITCODE)." }
& $wsl -d $Distro --exec bash $linuxPath $Mode.ToLowerInvariant() "$Jobs"
if ($LASTEXITCODE -ne 0) { throw "MoCI local build failed (exit $LASTEXITCODE). See the output log path above." }
