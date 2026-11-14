$ErrorActionPreference='Stop'
$path=Join-Path (Split-Path -Parent $PSScriptRoot) 'scripts\Repair-MoCI-CleanInstallClock.ps1'
$ast=[System.Management.Automation.Language.Parser]::ParseFile($path,[ref]$null,[ref]$null)
$definition=$ast.Find({param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Assert-CPUAPIC'},$true)
. ([scriptblock]::Create($definition.Extent.Text))
$file=Join-Path $PSScriptRoot ('cpu-apic-'+[guid]::NewGuid().ToString('N')+'.xml')
try {
    [IO.File]::WriteAllText($file,'<VirtualBox xmlns="http://www.virtualbox.org/"><Machine><Hardware><CPU><APIC enabled="false"/></CPU></Hardware></Machine></VirtualBox>')
    $caught=$false
    try { Assert-CPUAPIC $file } catch { $caught=$_.Exception.Message -match 'CPU APIC is disabled' }
    if (-not $caught) { throw 'Disabled CPU APIC must prevent startup.' }
    [IO.File]::WriteAllText($file,'<VirtualBox xmlns="http://www.virtualbox.org/"><Machine><Hardware><CPU><APIC enabled="true"/></CPU></Hardware></Machine></VirtualBox>')
    Assert-CPUAPIC $file
    [IO.File]::WriteAllText($file,'<VirtualBox xmlns="http://www.virtualbox.org/"><Machine><Hardware><CPU/></Hardware></Machine></VirtualBox>')
    Assert-CPUAPIC $file
    [IO.File]::WriteAllText($file,'<VirtualBox><Machine/></VirtualBox>')
    $caught=$false
    try { Assert-CPUAPIC $file } catch { $caught=$_.Exception.Message -match 'Cannot verify current CPU' }
    if (-not $caught) { throw 'Unverifiable CPU configuration must prevent startup.' }
    Write-Host 'PASS: disabled/unverifiable CPU APIC refused; enabled and default-enabled APIC accepted.'
} finally { Remove-Item -LiteralPath $file -ErrorAction SilentlyContinue }
