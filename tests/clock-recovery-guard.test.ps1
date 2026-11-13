# Only the identity/state guard is extracted. No VirtualBox process is called.
$ErrorActionPreference='Stop'
$path=Join-Path (Split-Path -Parent $PSScriptRoot) 'scripts\Repair-MoCI-CleanInstallClock.ps1'
$ast=[System.Management.Automation.Language.Parser]::ParseFile($path,[ref]$null,[ref]$null)
$definition=$ast.Find({param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Assert-Target'},$true)
. ([scriptblock]::Create($definition.Extent.Text))
$id='fresh-vm'
$state=@{name='MoCI-Clean-Install-Test';hardware_uuid='fresh-hardware'}
function Reset-Info {
    $script:info=@{
        '3164c3c8-a30a-4171-99ec-a4fc4bda96dd'=@{VMState='poweroff'}
        '97b3d07b-5b50-4662-9d1e-86f3fa22a857'=@{VMState='poweroff'}
        'fresh-vm'=@{VMState='running';name='MoCI-Clean-Install-Test';hardwareuuid='fresh-hardware'}
    }
}
function Get-VMInfo([string]$Id) { return $script:info[$Id] }
Reset-Info
Assert-Target 'running'
$script:info['3164c3c8-a30a-4171-99ec-a4fc4bda96dd']['VMState']='running'
$caught=$false
try { Assert-Target 'running' } catch { $caught=$_.Exception.Message -match 'preserved router VMs' }
if (-not $caught) { throw 'A running preserved router must prevent recovery.' }
Reset-Info
$script:info['fresh-vm']['hardwareuuid']='other-hardware'
$caught=$false
try { Assert-Target 'running' } catch { $caught=$_.Exception.Message -match 'identity/state changed' }
if (-not $caught) { throw 'Wrong hardware identity must prevent recovery.' }
Reset-Info
$caught=$false
try { Assert-Target 'poweroff' } catch { $caught=$_.Exception.Message -match 'identity/state changed' }
if (-not $caught) { throw 'State mismatch must prevent compatibility changes.' }
Write-Host 'PASS: expected identity accepted; active preserved VM, wrong identity and wrong state refused.'
