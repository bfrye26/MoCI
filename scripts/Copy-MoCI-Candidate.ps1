#Requires -Version 5.1
param(
    [string]$Source = '\\wsl.localhost\Ubuntu-24.04\home\bfrye26\Projects\MoCI-output\ship-01c164c69030-20261113T044108Z'
)
$ErrorActionPreference = 'Stop'
$expectedCommit = '01c164c69030db2c6f32d1af05ad30c220db12e9'
if (-not (Test-Path -LiteralPath $Source -PathType Container)) { throw "Build folder is not accessible: $Source" }
$versions = Get-Content -LiteralPath (Join-Path $Source 'source-versions.txt') -Raw
if ($versions -notmatch "(?m)^MOCI_COMMIT=$expectedCommit\r?$" ) { throw 'This is not the tested rc.2 source build.' }
$buildName = Split-Path -Leaf $Source.TrimEnd('\','/')
if ($buildName -notmatch '^ship-01c164c69030-[0-9]{8}T[0-9]{6}Z$') { throw 'Unexpected build folder name.' }
$destination = Join-Path 'C:\moci-build' $buildName
New-Item -ItemType Directory -Force -Path $destination | Out-Null
foreach ($item in Get-ChildItem -LiteralPath $Source -Force) {
    Copy-Item -LiteralPath $item.FullName -Destination $destination -Recurse -Force
}
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
        Write-Host "Verified: $relative"
        $entries++
    }
    if ($entries -eq 0) { throw "No checksums found in $checksum" }
}
$iso = @(Get-ChildItem -LiteralPath (Join-Path $destination 'installer') -File -Filter '*.iso')
if ($iso.Count -ne 1) { throw 'Expected exactly one installer ISO.' }
$projectInstaller = Join-Path (Split-Path -Parent $PSScriptRoot) 'artifacts\installer'
New-Item -ItemType Directory -Force -Path $projectInstaller | Out-Null
Copy-Item -LiteralPath $iso[0].FullName -Destination $projectInstaller -Force
Copy-Item -LiteralPath $iso[0].FullName -Destination 'C:\moci-build' -Force
Write-Host "Verified build: $destination"
Write-Host "Use this ISO for the disposable VM: $($iso[0].FullName)"
