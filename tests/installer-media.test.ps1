$ErrorActionPreference='Stop'
$path=Join-Path (Split-Path -Parent $PSScriptRoot) 'scripts\Test-MoCI-CleanInstall.ps1'
$ast=[System.Management.Automation.Language.Parser]::ParseFile($path,[ref]$null,[ref]$null)
$definition=$ast.Find({param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Test-InstallerMediaDetached'},$true)
. ([scriptblock]::Create($definition.Extent.Text))
if (-not (Test-InstallerMediaDetached @{'SATA-1-0'='emptydrive'})) { throw 'Empty drive must pass.' }
if (-not (Test-InstallerMediaDetached @{'SATA-1-0'='none'})) { throw 'Removed drive must pass.' }
if (Test-InstallerMediaDetached @{'SATA-1-0'='C:\installer.iso'}) { throw 'Attached ISO must fail.' }
if (Test-InstallerMediaDetached @{}) { throw 'Missing attachment and XML information must fail.' }
$file=Join-Path $PSScriptRoot ('vm-media-'+[guid]::NewGuid().ToString('N')+'.xml')
try {
    [IO.File]::WriteAllText($file,'<VirtualBox xmlns="http://www.virtualbox.org/"><Machine><StorageControllers><StorageController name="SATA"><AttachedDevice type="HardDisk"><Image uuid="disk"/></AttachedDevice></StorageController></StorageControllers></Machine></VirtualBox>')
    if (-not (Test-InstallerMediaDetached @{CfgFile=$file})) { throw 'Missing slot with verified detached XML must pass.' }
    [IO.File]::WriteAllText($file,'<VirtualBox xmlns="http://www.virtualbox.org/"><Machine><StorageControllers><StorageController name="SATA"><AttachedDevice type="DVD"><Image uuid="iso"/></AttachedDevice></StorageController></StorageControllers></Machine></VirtualBox>')
    if (Test-InstallerMediaDetached @{CfgFile=$file}) { throw 'An attached DVD image in XML must fail.' }
    [IO.File]::WriteAllText($file,'<VirtualBox xmlns="http://www.virtualbox.org/"><Machine><Snapshot><StorageControllers><StorageController><AttachedDevice type="DVD"><Image uuid="historical-iso"/></AttachedDevice></StorageController></StorageControllers></Snapshot><StorageControllers><StorageController name="SATA"/></StorageControllers></Machine></VirtualBox>')
    if (-not (Test-InstallerMediaDetached @{CfgFile=$file})) { throw 'Historical snapshot media must not count as a current attachment.' }
    Write-Host 'PASS: empty/removed DVD accepted, attached/unknown media refused, current XML distinguished from snapshots.'
} finally { Remove-Item -LiteralPath $file -ErrorAction SilentlyContinue }
