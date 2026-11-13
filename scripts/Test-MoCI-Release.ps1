param([string]$RouterAddress = '192.168.50.1')
$ErrorActionPreference = 'Stop'
$parsedAddress = $null
if (-not [System.Net.IPAddress]::TryParse($RouterAddress, [ref]$parsedAddress)) { throw 'RouterAddress must be an IP address.' }
$project = Split-Path -Parent $PSScriptRoot
$name = 'release-check-' + [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssZ')
$output = Join-Path $project ('artifacts\' + $name)
New-Item -ItemType Directory -Path $output | Out-Null
$remote = "root@$RouterAddress"
$stage = "/tmp/$name"
& ssh $remote "mkdir -m 700 '$stage'"
if ($LASTEXITCODE -ne 0) { throw 'Router SSH connection failed. No tests were started.' }
& scp -O ((Join-Path $PSScriptRoot 'router-release-check.py') -replace '\\','/') "${remote}:$stage/"
if ($LASTEXITCODE -ne 0) { throw 'Could not stage router checks.' }
& ssh $remote "python3 '$stage/router-release-check.py'"
if ($LASTEXITCODE -ne 0) { throw 'Router checks did not complete. No release pass was recorded.' }
foreach ($file in @('report.json','backup-sha256.txt','configuration-backup.tar.gz')) {
    & scp -O "${remote}:$stage/$file" (Join-Path $output $file)
    if ($LASTEXITCODE -ne 0) { throw "Could not retrieve $file. Available results: $output" }
}
$expected = (Get-Content -LiteralPath (Join-Path $output 'backup-sha256.txt') -Raw).Trim()
$actual = (Get-FileHash -LiteralPath (Join-Path $output 'configuration-backup.tar.gz') -Algorithm SHA256).Hash.ToLowerInvariant()
if ($actual -ne $expected) { throw 'Downloaded backup checksum mismatch.' }
$report = Get-Content -LiteralPath (Join-Path $output 'report.json') -Raw | ConvertFrom-Json
Write-Host "Backup download checksum verified. Results: $output"
Write-Host 'The backup contains private router configuration. Keep it private.'
if (@($report.checks | Where-Object status -eq 'FAIL').Count) { throw 'One or more router checks failed. Read report.json.' }
Write-Host 'These checks passed. Restore, upgrade, external-client and physical hardware gates remain open.'
