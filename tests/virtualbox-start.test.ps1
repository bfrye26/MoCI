# Runs only the extracted retry function with fakes. Never invokes VirtualBox.
$ErrorActionPreference='Stop'
$path=Join-Path (Split-Path -Parent $PSScriptRoot) 'scripts\Test-MoCI-ColdBoot.ps1'
$ast=[System.Management.Automation.Language.Parser]::ParseFile($path,[ref]$null,[ref]$null)
$definition=$ast.Find({param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Start-TestVM'},$true)
if (-not $definition) { throw 'Start-TestVM function is missing.' }
. ([scriptblock]::Create($definition.Extent.Text))
$vbox='Invoke-FakeVBox'
$cloneId='fake-test-vm'
function Assert-TestVM([string]$ExpectedState) {
    if ($ExpectedState -ne 'poweroff') { throw 'Expected a powered-off identity guard.' }
    $script:guards++
    if ($script:refuseGuard) { throw 'Identity guard refused the VM' }
}
function Start-Sleep([int]$Seconds) {}
function Invoke-FakeVBox {
    $script:calls++
    $reply=$script:replies.Dequeue()
    $global:LASTEXITCODE=$reply.code
    Write-Output $reply.message
}
function Reset-Fakes {
    $script:calls=0;$script:guards=0;$script:refuseGuard=$false
    $script:replies=New-Object 'System.Collections.Generic.Queue[object]'
}
Reset-Fakes
$script:replies.Enqueue(@{code=1;message='Machine is already locked by a session (or being locked or unlocked)'})
$script:replies.Enqueue(@{code=0;message='VM started'})
Start-TestVM
if ($script:calls -ne 2 -or $script:guards -ne 2) { throw 'Lock retry did not recheck VM identity/state.' }
Reset-Fakes
$script:replies.Enqueue(@{code=1;message='Disk image is inaccessible'})
$caught=$false
try { Start-TestVM } catch { $caught=$_.Exception.Message -match 'Disk image is inaccessible' }
if (-not $caught -or $script:calls -ne 1) { throw 'Unexpected start errors must stop without retries.' }
Reset-Fakes
$script:refuseGuard=$true
$caught=$false
try { Start-TestVM } catch { $caught=$_.Exception.Message -match 'Identity guard refused' }
if (-not $caught -or $script:calls -ne 0) { throw 'Identity/state guard must prevent all start attempts.' }
Write-Host 'PASS: session-lock retry, stop on other errors, and identity/state checks before every start.'
