param([string]$RouterAddress = '192.168.50.1')
$ErrorActionPreference = 'Stop'
$parsedAddress = $null
if (-not [System.Net.IPAddress]::TryParse($RouterAddress, [ref]$parsedAddress)) {
    throw 'RouterAddress must be an IP address.'
}
$project = Split-Path -Parent $PSScriptRoot
$stageName = 'moci-core-fix-' + [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssZ') + '-' + [guid]::NewGuid().ToString('N').Substring(0,8)
$stage = Join-Path $project ('artifacts\' + $stageName)
New-Item -ItemType Directory -Path $stage | Out-Null
$files = @{
    'core.js' = 'dist\moci\js\core.js'
    'network.js' = 'dist\moci\js\modules\network.js'
    'system.js' = 'dist\moci\js\modules\system.js'
    'dashboard.js' = 'dist\moci\js\modules\dashboard.js'
    'advanced.js' = 'dist\moci\js\modules\advanced.js'
    'app.css' = 'dist\moci\app.css'
    'index.html' = 'dist\moci\index.html'
}
$checksums = @{}
foreach ($name in $files.Keys) {
    $source = Join-Path $project $files[$name]
    if (-not (Test-Path -LiteralPath $source)) { throw "Frontend build missing: $source" }
    Copy-Item -LiteralPath $source -Destination (Join-Path $stage $name)
    $checksums[$name] = (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash.ToLowerInvariant()
}
[System.IO.File]::WriteAllText((Join-Path $stage 'checksums.json'), ($checksums | ConvertTo-Json), [System.Text.UTF8Encoding]::new($false))
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'apply-core-fixes.py') -Destination $stage
$remote = "root@$RouterAddress"
$remoteStage = "/tmp/$stageName"
# Keep the actual SSH diagnostic. Do not remove host keys or bypass host verification.
$previousErrorPreference = $ErrorActionPreference
try {
    $ErrorActionPreference = 'Continue'
    $stageOutput = @(& ssh -o ConnectTimeout=10 -o ConnectionAttempts=1 $remote "mkdir -m 700 '$remoteStage'" 2>&1)
    $stageExitCode = $LASTEXITCODE
} finally {
    $ErrorActionPreference = $previousErrorPreference
}
if ($stageExitCode -ne 0) {
    $detail = ($stageOutput | ForEach-Object { $_.ToString() }) -join [Environment]::NewLine
    throw "Router staging failed through SSH (exit $stageExitCode). No router UI files were changed.$([Environment]::NewLine)$detail$([Environment]::NewLine)Check the connection directly with: ssh root@$RouterAddress"
}
foreach ($file in Get-ChildItem -LiteralPath $stage -File) {
    & scp -O $file.FullName "${remote}:$remoteStage/"
    if ($LASTEXITCODE -ne 0) { throw "Upload failed: $($file.Name). Installed firmware was not changed." }
}
& ssh $remote "python3 '$remoteStage/apply-core-fixes.py'"
if ($LASTEXITCODE -ne 0) { throw 'Core update failed. Review the output above before retrying.' }
