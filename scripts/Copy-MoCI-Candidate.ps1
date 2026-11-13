#Requires -Version 5.1
param(
    [string]$Source = '\\wsl.localhost\Ubuntu-24.04\home\bfrye26\Projects\MoCI-output\ship-8cd226c8b7b8-20261113T170016Z'
)
$ErrorActionPreference = 'Stop'
$expectedCommit = '8cd226c8b7b8689990a17ad953820a5d12b36750'
if (-not (Test-Path -LiteralPath $Source -PathType Container)) { throw "Build folder is not accessible: $Source" }
$versions = Get-Content -LiteralPath (Join-Path $Source 'source-versions.txt') -Raw
if ($versions -notmatch "(?m)^MOCI_COMMIT=$expectedCommit\r?$" ) { throw 'This is not the CI-validated rc.4 source build.' }
$buildName = Split-Path -Leaf $Source.TrimEnd('\','/')
if ($buildName -notmatch '^ship-8cd226c8b7b8-[0-9]{8}T[0-9]{6}Z$') { throw 'Unexpected build folder name.' }
$destination = Join-Path 'C:\moci-build' $buildName
New-Item -ItemType Directory -Force -Path $destination | Out-Null
foreach ($item in Get-ChildItem -LiteralPath $Source -Force) {
    Copy-Item -LiteralPath $item.FullName -Destination $destination -Recurse -Force
}
$verified = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
foreach ($checksum in @('SHA256SUMS','installer\SHA256SUMS')) {
    $manifest = Join-Path $destination $checksum
    $folder = Split-Path -Parent $manifest
    $entries = 0
    foreach ($line in Get-Content -LiteralPath $manifest) {
        if (-not $line.Trim()) { continue }
        if ($line -notmatch '^([0-9a-fA-F]{64})\s+\*?(.+?)\s*$') { throw "Invalid checksum entry in $checksum" }
        $expected = $Matches[1].ToLowerInvariant()
        $relative = $Matches[2].Replace('/','\')
        $file = [IO.Path]::GetFullPath((Join-Path $folder $relative))
        if (-not $file.StartsWith($folder.TrimEnd('\')+'\',[StringComparison]::OrdinalIgnoreCase)) { throw 'Checksum path is outside its build directory.' }
        $actual = (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant()
        if ($actual -ne $expected) { throw "Checksum mismatch: $file" }
        $null = $verified.Add($file)
        Write-Host "Verified: $relative"
        $entries++
    }
    if ($entries -eq 0) { throw "No checksums found in $checksum" }
}
$iso = @(Get-ChildItem -LiteralPath (Join-Path $destination 'installer') -File -Filter '*.iso')
if ($iso.Count -ne 1) { throw 'Expected exactly one installer ISO.' }
$firmware = Join-Path $destination 'openwrt-x86-64-generic-ext4-combined-efi.img.gz'
if (-not $verified.Contains([IO.Path]::GetFullPath($firmware)) -or -not $verified.Contains($iso[0].FullName)) { throw 'Firmware and ISO must both appear in verified checksum manifests.' }
$projectCandidate = Join-Path (Split-Path -Parent $PSScriptRoot) ('artifacts\candidates\'+$buildName)
New-Item -ItemType Directory -Force -Path $projectCandidate | Out-Null
foreach ($name in @('openwrt-x86-64-generic-ext4-combined-efi.img.gz','SHA256SUMS','source-versions.txt')) {
    Copy-Item -LiteralPath (Join-Path $destination $name) -Destination $projectCandidate -Force
}
$projectInstaller = Join-Path (Split-Path -Parent $PSScriptRoot) 'artifacts\installer'
New-Item -ItemType Directory -Force -Path $projectInstaller | Out-Null
Copy-Item -LiteralPath $iso[0].FullName -Destination $projectInstaller -Force
Copy-Item -LiteralPath $iso[0].FullName -Destination 'C:\moci-build' -Force
Write-Host "Verified build: $destination"
Write-Host "Firmware for upgrade validation: $firmware"
Write-Host "Project candidate copy: $projectCandidate"
Write-Host "Installer ISO (fresh installs only): $($iso[0].FullName)"
Write-Host 'No VM was changed. Do not use the installer ISO as a firmware upgrade payload.'
