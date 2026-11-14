"""Preflight/verify a pinned image on a guarded disposable VM; flash only explicitly."""
import argparse
import gzip
import hashlib
import json
import os
from pathlib import Path
import runpy
import subprocess
import struct
import sys
import tarfile
import uuid

VERSION='1.0.0-rc.1'
IMAGE_SHA='d68a89a508f9c5441ab0cbce9d1c840ef59525062bfa550348e32835606e3de0'
RUNTIME_SHA='13e3117daaeb2b4755d8f66b35375feb486adf9387a08e5adf48e44bbf485f19'
GROW_SHA='d293c8e93fdffc51e138de88f5c938239b7b8b95c1bdc1ca9f314c31318b3947'
CORE=tuple('/etc/config/'+name for name in ('system','network','dhcp','firewall','dockerd'))


def command(args, timeout=30):
    result=subprocess.run(args,capture_output=True,text=True,timeout=timeout)
    if result.returncode:
        raise RuntimeError(f'{args[0]} {args[1] if len(args)>1 else ""} failed ({result.returncode}): '+result.stderr[-700:])
    return result.stdout.strip()


def identify(expected):
    expected=uuid.UUID(expected)
    actual=uuid.UUID(Path('/sys/class/dmi/id/product_uuid').read_text().strip())
    if actual not in (expected,uuid.UUID(bytes=expected.bytes_le)):
        raise RuntimeError('Target is not the expected disposable VM')


def digest(path):
    checksum=hashlib.sha256()
    with Path(path).open('rb') as source:
        for block in iter(lambda:source.read(1024*1024),b''): checksum.update(block)
    return checksum.hexdigest()


def empty_app_state():
    if command(['docker','ps','-aq']) or command(['docker','volume','ls','-q']):
        raise RuntimeError('App containers or volumes exist; their data needs a persistence/migration plan before upgrading')
    stacks=Path('/srv/moci-docker/stacks')
    if stacks.exists() and any(stacks.iterdir()):
        raise RuntimeError('Application stacks exist; refusing to overwrite their root filesystem')


def validate_image(image):
    if not image.name.endswith('.img.gz') or digest(image)!=IMAGE_SHA:
        raise RuntimeError('Image does not match the pinned rc.5 firmware checksum')
    command(['/sbin/sysupgrade','-T',str(image)],120)


def verify_storage_image():
    helper='/usr/libexec/moci-grow-root'
    if digest(helper)!=GROW_SHA:
        raise RuntimeError('Installed storage helper does not match rc.5')
    storage=runpy.run_path(helper)
    disk,root,disk_bytes=storage['root_device']()
    table=json.loads(command(['sfdisk','--json',disk]))['partitiontable']
    plan=storage['growth_plan'](table,disk_bytes,root)
    if plan['grow_partition']:
        raise RuntimeError('Automatic first-boot partition growth did not complete')
    with open(root,'rb') as source:
        source.seek(1024);superblock=source.read(1024)
    if len(superblock)!=1024 or superblock[56:58]!=b'\x53\xef':
        raise RuntimeError('Expected ext4 root superblock')
    if struct.unpack_from('<I',superblock,92)[0]&0x10:
        raise RuntimeError('Legacy resize_inode metadata remains in the installed image')
    return {'helper_sha256':GROW_SHA,'resize_inode':False,'partition_bytes':plan['before_sectors']*512}


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--expect-hardware-uuid',required=True)
    mode=parser.add_mutually_exclusive_group(required=True)
    mode.add_argument('--prepare',action='store_true')
    mode.add_argument('--flash',action='store_true')
    mode.add_argument('--verify',action='store_true')
    args=parser.parse_args()
    os.umask(0o077)
    root=Path(__file__).resolve().parent
    report={'schema':1,'release_ready':False,'success':False,'checks':[]}
    filename='upgrade-post.json' if args.verify else 'upgrade-preflight.json'
    try:
        identify(args.expect_hardware_uuid)
        report['checks'].append({'name':'disposable-vm-identity','status':'PASS'})
        if args.verify:
            before=json.loads((root/'upgrade-preflight.json').read_text())
            if before.get('image_sha256')!=IMAGE_SHA or not before.get('success'):
                raise RuntimeError('Missing valid pre-upgrade baseline')
            filesystem=os.statvfs('/')
            report['root_filesystem_bytes']={'before':before['root_filesystem_bytes'],'after':filesystem.f_blocks*filesystem.f_frsize}
            release=Path('/etc/moci-release').read_text()
            if 'MOCI_VERSION='+VERSION not in release.splitlines():
                raise RuntimeError('Installed firmware is not '+VERSION)
            if digest('/usr/libexec/moci-runtime-defaults')!=RUNTIME_SHA:
                raise RuntimeError('Installed runtime defaults do not match the pinned candidate')
            report['checks'].append({'name':'installed-version-and-runtime-source','status':'PASS'})
            report['storage_image']=verify_storage_image()
            report['checks'].append({'name':'installed-storage-source-and-automatic-growth','status':'PASS'})
            if set(before['core_sha256'])!=set(CORE):
                raise RuntimeError('Unexpected configuration baseline file list')
            for path,expected in before['core_sha256'].items():
                if digest(path)!=expected:
                    raise RuntimeError('Configuration changed across upgrade: '+path)
            report['checks'].append({'name':'router-configuration-retained','status':'PASS'})
            runtime=runpy.run_path('/usr/libexec/moci-runtime-defaults')
            nut=runtime['config']('nut_server')
            manual=Path('/etc/nut/ups.conf')
            configured=any(item.get('.type')=='driver' for item in nut.values()) or (manual.is_file() and '[' in manual.read_text())
            if not configured:
                status=subprocess.run(['/etc/init.d/nut-server','enabled'],capture_output=True)
                if status.returncode==0: raise RuntimeError('Unconfigured UPS was re-enabled during upgrade')
                report['checks'].append({'name':'unconfigured-ups-remains-disabled','status':'PASS'})
            if not runtime['bridge_ready'](): raise RuntimeError('Default Docker bridge did not persist')
            if runtime['return_policy_plan'](runtime['config']('dockerd'))!='ALREADY_CONFIGURED':
                raise RuntimeError('Docker WAN reply policy did not persist')
            report['checks'].append({'name':'docker-bridge-and-return-policy-persist','status':'PASS'})
            runtime['run'](['docker','pull','busybox:1.37'],180)
            runtime['smoke_test'](report,'busybox:1.37')
            for script in ('router-release-check.py','router-client-check.py'):
                command([sys.executable,str(root/script)],120)
            router=json.loads((root/'report.json').read_text())
            client=json.loads((root/'client-report.json').read_text())
            if any(check['status']!='PASS' for check in router['checks']) or not client.get('client_checks_passed') or client.get('cleanup')!='PASS':
                raise RuntimeError('Post-upgrade router/client validation did not pass')
            report['checks'].append({'name':'post-upgrade-router-and-client-connectivity','status':'PASS'})
            if report['root_filesystem_bytes']['after'] < before['root_filesystem_bytes']*0.95:
                raise RuntimeError('Usable root filesystem capacity shrank across upgrade; storage migration/growth requires correction')
            report['checks'].append({'name':'root-filesystem-capacity-retained','status':'PASS'})
            report['success']=True
        else:
            if command(['uci','changes']): raise RuntimeError('Pending UCI changes exist')
            empty_app_state()
            image=root/'candidate.img.gz'
            validate_image(image)
            if args.flash:
                before=json.loads((root/'upgrade-preflight.json').read_text())
                if not before.get('success') or before.get('image_sha256')!=IMAGE_SHA:
                    raise RuntimeError('A successful preflight is required before flashing')
                if set(before['core_sha256'])!=set(CORE) or any(digest(path)!=value for path,value in before['core_sha256'].items()):
                    raise RuntimeError('Settings changed after preflight; refusing to flash')
                identify(args.expect_hardware_uuid)
                print('Validated rc.5 image; starting sysupgrade on the disposable VM. SSH will disconnect.',flush=True)
                os.execv('/sbin/sysupgrade',['/sbin/sysupgrade',str(image)])
            archive=root/'configuration-backup.tar.gz'
            command(['/sbin/sysupgrade','--create-backup',str(archive)],60)
            archive.chmod(0o600)
            with gzip.open(archive,'rb') as stream:
                while stream.read(1024*1024): pass
            with tarfile.open(archive,'r:gz') as bundle:
                names={member.name.removeprefix('./') for member in bundle if member.isfile()}
                if not {path.lstrip('/') for path in CORE}.issubset(names):
                    raise RuntimeError('Configuration backup is missing core settings')
            filesystem=os.statvfs('/')
            report.update(image_sha256=IMAGE_SHA,backup_sha256=digest(archive),core_sha256={path:digest(path) for path in CORE},root_filesystem_bytes=filesystem.f_blocks*filesystem.f_frsize,success=True)
            report['checks'].extend([{'name':name,'status':'PASS'} for name in ('empty-app-state','image-checksum-and-sysupgrade-test','fresh-backup')])
    except Exception as error:
        report['checks'].append({'name':'upgrade-validation','status':'FAIL','detail':str(error)})
    # execv replaces this process on a real flash; request != completion.
    if not args.flash or not report['success']:
        (root/filename).write_text(json.dumps(report,indent=2)+'\n')
        print(json.dumps(report,indent=2))
    return 0 if report['success'] else 1


if __name__=='__main__':
    sys.exit(main())
