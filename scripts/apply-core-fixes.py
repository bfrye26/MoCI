"""Apply a staged MoCI UI update, preserving the installed ACL and a local backup."""
import hashlib
import json
import pathlib
import re
import shutil
import subprocess
import sys
import time

stage = pathlib.Path(__file__).resolve().parent
release = pathlib.Path('/etc/moci-release').read_text()
if not re.search(r'^MOCI_VERSION=[\'\"]?0\.11\.', release, re.M):
    raise SystemExit('This update requires an installed MoCI 0.11.x candidate.')
targets = {
    'core.js': pathlib.Path('/www/moci/js/core.js'),
    'network.js': pathlib.Path('/www/moci/js/modules/network.js'),
    'system.js': pathlib.Path('/www/moci/js/modules/system.js'),
    'index.html': pathlib.Path('/www/moci/index.html'),
}
expected = json.loads((stage / 'checksums.json').read_text())
for name, target in targets.items():
    if not target.is_file():
        raise SystemExit('Required installed UI file missing: ' + str(target))
    if hashlib.sha256((stage / name).read_bytes()).hexdigest() != expected[name]:
        raise SystemExit('Staged update checksum mismatch: ' + name)
acl_path = pathlib.Path('/usr/share/rpcd/acl.d/moci.json')
acl = json.loads(acl_path.read_text())
read_methods = acl['moci']['read']['ubus']['uci']
if 'changes' not in read_methods:
    read_methods.append('changes')
write_methods = acl['moci']['write']['ubus']['uci']
for method in ('rollback', 'revert'):
    if method not in write_methods:
        write_methods.append(method)
backup = pathlib.Path('/root') / ('moci-core-backup-' + time.strftime('%Y%m%dT%H%M%SZ', time.gmtime()))
backup.mkdir(mode=0o700)
originals = list(targets.values()) + [acl_path]
for target in originals:
    shutil.copy2(target, backup / target.name)
try:
    for name, target in targets.items():
        temporary = target.with_name(target.name + '.moci-update')
        shutil.copyfile(stage / name, temporary)
        temporary.chmod(0o644)
        temporary.replace(target)
    temporary = acl_path.with_name('moci.json.moci-update')
    temporary.write_text(json.dumps(acl, indent=2) + '\n')
    temporary.chmod(0o644)
    temporary.replace(acl_path)
    subprocess.run(['/etc/init.d/rpcd', 'reload'], check=True)
except Exception:
    for target in originals:
        shutil.copy2(backup / target.name, target)
    subprocess.run(['/etc/init.d/rpcd', 'reload'], check=False)
    raise
print('Core UI update installed. Backup: ' + str(backup))
print('Reload the browser with Ctrl+F5 and sign in again if required. No network settings were changed.')
