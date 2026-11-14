"""Validate a fresh rc.5 installation without applying firmware/runtime repairs."""
import argparse
import json
import os
from pathlib import Path
import re
import runpy
import subprocess
import sys
import time


def mac(value):
    value=value.replace(':','').lower()
    if not re.fullmatch('[0-9a-f]{12}',value): raise RuntimeError('Invalid Ethernet MAC address')
    return value


def check_mapping(expected_lan,expected_wan,query,netroot=Path('/sys/class/net')):
    lan=json.loads(query(['ubus','call','network.interface.lan','status']))
    wan=json.loads(query(['ubus','call','network.interface.wan','status']))
    if not lan.get('up') or not wan.get('up'): raise RuntimeError('LAN and WAN must both be up')
    if not any(entry.get('address')=='192.168.50.1' and entry.get('mask')==24 for entry in lan.get('ipv4-address',[])):
        raise RuntimeError('LAN does not have the installer-selected 192.168.50.1/24 address')
    bridge=lan.get('l3_device','')
    uplink=wan.get('l3_device','')
    if bridge!='br-lan' or not re.fullmatch('[A-Za-z0-9_.:-]+',uplink):
        raise RuntimeError('Unexpected LAN bridge or WAN device')
    # brif/<port> only lists bridge membership; the MAC lives on the interface
    # itself at /sys/class/net/<port>/address, not inside the brif subdirectory.
    members={mac((netroot/port.name/'address').read_text().strip()) for port in (netroot/bridge/'brif').iterdir()}
    if mac(expected_lan) not in members: raise RuntimeError('LAN does not contain the recorded host-only adapter MAC')
    if mac((netroot/uplink/'address').read_text().strip())!=mac(expected_wan):
        raise RuntimeError('WAN does not use the recorded NAT adapter MAC')
    if query(['uci','-q','get','network.wan.proto'])!='dhcp': raise RuntimeError('Fresh WAN must use DHCP')
    return {'lan_device':bridge,'wan_device':uplink,'lan_mac':mac(expected_lan),'wan_mac':mac(expected_wan)}


def verify_capacity(partition_bytes,filesystem_bytes,expected_disk_bytes):
    if not expected_disk_bytes*0.99<=partition_bytes<=expected_disk_bytes:
        raise RuntimeError('Installed root partition does not fill the recorded fresh disk')
    if not partition_bytes*0.95<=filesystem_bytes<=partition_bytes:
        raise RuntimeError('Fresh root filesystem has not expanded to the expected capacity')


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--expect-hardware-uuid',required=True)
    parser.add_argument('--expect-lan-mac',required=True)
    parser.add_argument('--expect-wan-mac',required=True)
    parser.add_argument('--expect-disk-bytes',required=True,type=int)
    args=parser.parse_args()
    os.umask(0o077)
    root=Path(__file__).resolve().parent
    report={'schema':1,'success':False,'release_ready':False,'checks':[],
            'generated_utc':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),
            'remaining_gates':['external WAN isolation','firewall traffic controls and port forwarding',
                               'management-loss rollback','physical hardware and Wi-Fi','durable app-data migration']}
    try:
        upgrade=runpy.run_path(str(root/'router-upgrade-check.py'))
        upgrade['identify'](args.expect_hardware_uuid)
        report['checks'].append({'name':'fresh-vm-identity','status':'PASS'})
        if 'MOCI_VERSION='+upgrade['VERSION'] not in Path('/etc/moci-release').read_text().splitlines():
            raise RuntimeError('Installed version is not the pinned rc.5 candidate')
        if upgrade['digest']('/usr/libexec/moci-runtime-defaults')!=upgrade['RUNTIME_SHA']:
            raise RuntimeError('Installed runtime helper differs from the candidate')
        report['checks'].append({'name':'installed-version-and-runtime-source','status':'PASS'})
        report['storage_image']=upgrade['verify_storage_image']()
        filesystem=os.statvfs('/')
        report['filesystem_bytes']=filesystem.f_blocks*filesystem.f_frsize
        verify_capacity(report['storage_image']['partition_bytes'],report['filesystem_bytes'],args.expect_disk_bytes)
        report['checks'].append({'name':'fresh-root-expanded-and-corrected','status':'PASS'})
        report['mapping']=check_mapping(args.expect_lan_mac,args.expect_wan_mac,upgrade['command'])
        report['checks'].append({'name':'installer-lan-wan-mapping','status':'PASS'})
        runtime=runpy.run_path('/usr/libexec/moci-runtime-defaults')
        ups=subprocess.run(['/etc/init.d/nut-server','enabled'],capture_output=True)
        if ups.returncode==0: raise RuntimeError('Fresh unconfigured UPS service is enabled')
        report['checks'].append({'name':'fresh-unconfigured-ups-disabled','status':'PASS'})
        if not runtime['bridge_ready'](): raise RuntimeError('Fresh Docker bridge gateway is missing')
        if runtime['return_policy_plan'](runtime['config']('dockerd'))!='ALREADY_CONFIGURED':
            raise RuntimeError('Fresh Docker return policy is missing')
        if runtime['egress_plan'](runtime['config']('firewall'))!='ALREADY_CONFIGURED':
            raise RuntimeError('Fresh default Docker WAN forwarding is missing')
        report['checks'].append({'name':'fresh-docker-defaults','status':'PASS'})
        runtime['run'](['docker','pull','busybox:1.37'],180)
        runtime['smoke_test'](report,'busybox:1.37')
        for script in ('router-release-check.py','router-client-check.py'):
            upgrade['command']([sys.executable,str(root/script)],120)
        router=json.loads((root/'report.json').read_text())
        client=json.loads((root/'client-report.json').read_text())
        if any(item['status']!='PASS' for item in router['checks']) or not client.get('client_checks_passed') or client.get('cleanup')!='PASS':
            raise RuntimeError('Fresh-install router/client checks did not pass')
        report['checks'].append({'name':'fresh-router-and-client-connectivity','status':'PASS'})
        report['success']=True
    except Exception as error:
        report['checks'].append({'name':'fresh-install-validation','status':'FAIL','detail':str(error)})
    (root/'cleaninstall-report.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps(report,indent=2))
    return 0 if report['success'] else 1


if __name__=='__main__': sys.exit(main())
