"""Exercise configuration restore only on an explicitly identified disposable VM."""
import argparse
import gzip
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tarfile
import uuid


def command(args, timeout=30):
    result = subprocess.run(args, capture_output=True, text=True, timeout=timeout)
    if result.returncode:
        raise RuntimeError(f'{args[0]} returned {result.returncode}')
    return result.stdout.strip()


def verify_identity(expected):
    actual = uuid.UUID(Path('/sys/class/dmi/id/product_uuid').read_text().strip())
    canonical = uuid.UUID(expected)
    # SMBIOS/UEFI can expose the first three UUID fields in the opposite byte
    # order. Both accepted values still identify only this explicitly named VM.
    smbios_order = uuid.UUID(bytes=canonical.bytes_le)
    if actual not in (canonical, smbios_order):
        raise RuntimeError(f'Target hardware UUID does not match the disposable VM (actual {actual}; expected {canonical} or SMBIOS {smbios_order})')
    return str(actual)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--expect-hardware-uuid', required=True)
    parser.add_argument('--verify-only', action='store_true')
    parser.add_argument('--verify-identity-only', action='store_true')
    args = parser.parse_args()
    if args.verify_identity_only:
        verify_identity(args.expect_hardware_uuid)
        return 0
    os.umask(0o077)
    root = Path(__file__).resolve().parent
    report = {'schema':1,'release_ready':False,'restore_checks_passed':False,
              'post_boot':'NOT_TESTED','checks':[]}
    original = None
    modified = restored = False
    try:
        verify_identity(args.expect_hardware_uuid)
        report['checks'].append({'name':'disposable-vm-identity','status':'PASS'})
        if args.verify_only:
            baseline_hashes = json.loads((root/'baseline-sha256.json').read_text())
            expected_paths = {'/etc/config/'+name for name in ('system','network','dhcp','firewall')}
            if set(baseline_hashes) != expected_paths:
                raise RuntimeError('Unexpected baseline file list')
            for path, digest in baseline_hashes.items():
                if hashlib.sha256(Path(path).read_bytes()).hexdigest() != digest:
                    raise RuntimeError('Restored configuration did not persist after cold start')
            report['checks'].append({'name':'post-boot-core-files-match','status':'PASS'})
            report['post_boot'] = 'PASS'
            report['restore_checks_passed'] = True
            return 0
        if command(['uci','changes']):
            raise RuntimeError('Pending UCI edits exist; finish or discard them before this test')
        paths = [Path('/etc/config')/name for name in ('system','network','dhcp','firewall')]
        baseline = {path.as_posix():path.read_bytes() for path in paths}
        (root/'baseline-sha256.json').write_text(json.dumps({path:hashlib.sha256(data).hexdigest() for path,data in baseline.items()}))
        original = baseline['/etc/config/system']
        archive = root/'configuration-backup.tar.gz'
        command(['/sbin/sysupgrade','--create-backup',str(archive)],60)
        archive.chmod(0o600)
        # Consume gzip to EOF so its integrity check runs, with a bounded size.
        total = 0
        with gzip.open(archive,'rb') as compressed:
            while block := compressed.read(1024*1024):
                total += len(block)
                if total > 64*1024*1024:
                    raise RuntimeError('Backup exceeds the 64 MiB test limit')
        with tarfile.open(archive,'r:gz') as backup:
            members = {member.name.removeprefix('./').lstrip('/'):member for member in backup.getmembers()}
            for path, data in baseline.items():
                member = members.get(path.lstrip('/'))
                if member is None or not member.isfile():
                    raise RuntimeError('Backup is missing a core configuration file')
                with backup.extractfile(member) as source:
                    if source.read() != data:
                        raise RuntimeError('Backup does not match current core configuration')
        digest = hashlib.sha256(archive.read_bytes()).hexdigest()
        (root/'backup-sha256.txt').write_text(digest+'\n')
        report['backup_sha256'] = digest
        report['checks'].append({'name':'fresh-backup-integrity','status':'PASS'})
        marker = 'moci-restore-'+uuid.uuid4().hex[:8]
        modified = True
        command(['uci','set','system.@system[0].hostname='+marker])
        command(['uci','commit','system'])
        if command(['uci','get','system.@system[0].hostname']) != marker:
            raise RuntimeError('Temporary configuration change did not take effect')
        report['checks'].append({'name':'temporary-setting-changed','status':'PASS'})
        verify_identity(args.expect_hardware_uuid)
        command(['/sbin/sysupgrade','--restore-backup',str(archive)],60)
        for path, data in baseline.items():
            if Path(path).read_bytes() != data:
                raise RuntimeError('Restored core configuration does not match its baseline')
        restored = True
        report['checks'].append({'name':'restored-core-files-match','status':'PASS'})
        command(['/sbin/fw4','check'])
        report['checks'].append({'name':'restored-firewall-syntax','status':'PASS'})
        report['restore_checks_passed'] = True
    except Exception as error:
        report['checks'].append({'name':'restore-test','status':'FAIL','detail':str(error)})
    finally:
        if modified and not restored and original is not None:
            try:
                Path('/etc/config/system').write_bytes(original)
                command(['uci','revert','system'])
                report['temporary-setting-recovery'] = 'PASS'
            except Exception:
                report['temporary-setting-recovery'] = 'FAIL: use the baseline VM snapshot'
        filename = 'restore-post-boot.json' if args.verify_only else 'restore-report.json'
        (root/filename).write_text(json.dumps(report,indent=2)+'\n')
        print(json.dumps(report,indent=2))
    return 0 if report['restore_checks_passed'] else 1


if __name__ == '__main__':
    sys.exit(main())
