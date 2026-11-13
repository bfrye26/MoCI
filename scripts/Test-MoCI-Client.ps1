param([string]$RouterAddress = '192.168.50.1')
$ErrorActionPreference = 'Stop'
$parsedAddress = $null
if (-not [System.Net.IPAddress]::TryParse($RouterAddress, [ref]$parsedAddress)) { throw 'RouterAddress must be an IP address.' }
$project = Split-Path -Parent $PSScriptRoot
$name = 'client-check-' + [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssZ') + '-' + [guid]::NewGuid().ToString('N').Substring(0,8)
$output = Join-Path $project ('artifacts\' + $name)
New-Item -ItemType Directory -Path $output | Out-Null
$remote = "root@$RouterAddress"
$stage = "/tmp/$name"
& ssh -o ConnectTimeout=10 -o ConnectionAttempts=1 $remote "mkdir -m 700 '$stage'"
if ($LASTEXITCODE -ne 0) { throw 'Router SSH connection failed. Client tests were not started.' }
& scp -O ((Join-Path $PSScriptRoot 'router-client-check.py') -replace '\\','/') "${remote}:$stage/"
if ($LASTEXITCODE -ne 0) { throw 'Could not upload client test.' }
& ssh -o ServerAliveInterval=10 -o ServerAliveCountMax=3 $remote "python3 '$stage/router-client-check.py'"
$testExit = $LASTEXITCODE
& scp -O "${remote}:$stage/client-report.json" (Join-Path $output 'client-report.json')
if ($LASTEXITCODE -ne 0) { throw "No client report could be retrieved. Check the router for a remaining moci-test namespace. Results: $output" }
$report = Get-Content -LiteralPath (Join-Path $output 'client-report.json') -Raw | ConvertFrom-Json
Write-Host "Client report: $output\client-report.json"
if ($testExit -ne 0 -or -not $report.client_checks_passed -or $report.cleanup -ne 'PASS') { throw 'Client validation did not pass. Read the report; no release pass was recorded.' }
Write-Host 'LAN client checks passed. WAN isolation, physical clients, restore and upgrade remain untested.'
