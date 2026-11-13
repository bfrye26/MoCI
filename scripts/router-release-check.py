"""Bounded checks on the installed lab router. Does not apply configuration or reboot."""
import gzip
import hashlib
import json
import os
import pathlib
import re
import subprocess
import tarfile
import time

root = pathlib.Path(__file__).resolve().parent
os.umask(0o077)
checks = []
def command(args, timeout=20):
    return subprocess.run(args, capture_output=True, text=True, timeout=timeout)
def check(name, fn):
    try:
        ok, detail = fn()
        checks.append(dict(name=name, status='PASS' if ok else 'FAIL', detail=detail))
    except Exception as error:
        checks.append(dict(name=name, status='FAIL', detail=type(error).__name__))
def dns():
    result = command(['nslookup','openwrt.org','127.0.0.1'])
    return result.returncode == 0, 'Router-local DNS query completed' if result.returncode == 0 else 'Router-local DNS query failed'
def ping():
    result = command(['ping','-c','5','-W','2','1.1.1.1'])
    return result.returncode == 0 and bool(re.search(r'\b0% packet loss',result.stdout)), 'Five upstream probes; router-originated only'
def interface(name):
    result = command(['ubus','call','network.interface.'+name,'status'])
    data = json.loads(result.stdout)
    return result.returncode == 0 and data.get('up') is True, 'Interface is up' if data.get('up') else 'Interface is down'
def firewall():
    result = command(['/sbin/fw4','check'], timeout=30)
    return result.returncode == 0, 'fw4 configuration validation; external isolation still requires a separate WAN client'
def firewall_policy():
    data = json.loads(command(['ubus','call','uci','get',json.dumps({'config':'firewall'})]).stdout)
    zones = [v for v in data['values'].values() if isinstance(v,dict) and v.get('.type')=='zone' and v.get('name')=='wan']
    ok = len(zones)==1 and zones[0].get('input') in ('REJECT','DROP') and zones[0].get('forward') in ('REJECT','DROP')
    return ok, 'WAN zone input and forwarding reject/drop; individual rules still require external testing'
def backup():
    archive = root / 'configuration-backup.tar.gz'
    result = command(['/sbin/sysupgrade','--create-backup',str(archive)], timeout=60)
    if result.returncode != 0 or not archive.is_file():
        return False, 'Backup command failed'
    archive.chmod(0o600)
    # Read archive headers only, never extract or report private file contents.
    with tarfile.open(archive,'r:gz') as bundle:
        names = {m.name.removeprefix('./') for m in bundle.getmembers() if m.isfile()}
    required = {'etc/config/network','etc/config/firewall','etc/config/dhcp','etc/config/system'}
    if not required.issubset(names):
        return False, 'Backup is missing one or more required router configuration files'
    with gzip.open(archive,'rb') as stream:
        while stream.read(1024*1024):
            pass
    digest = hashlib.sha256(archive.read_bytes()).hexdigest()
    (root/'backup-sha256.txt').write_text(digest+'\n')
    return True, 'gzip/archive integrity and four required configuration files verified; restore untested'

check('lan-interface',lambda:interface('lan'))
check('wan-interface',lambda:interface('wan'))
check('router-dns',dns)
check('router-upstream-ping',ping)
check('firewall-syntax',firewall)
check('wan-default-policies',firewall_policy)
check('backup-integrity',backup)
try:
    route6 = command(['ip','-6','route','show','default'])
    ipv6 = {'status': 'UNKNOWN' if route6.returncode else ('DEFAULT_ROUTE_PRESENT' if route6.stdout.strip() else 'NO_DEFAULT_ROUTE')}
except Exception:
    ipv6 = {'status':'UNKNOWN'}
report = {'schema':1,'generated_utc':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),
          'checks':checks,'ipv6':ipv6,'release_ready':False,
          'remaining_gates':['independent LAN client forwarding and DHCP renewal','external WAN isolation',
                             'backup restore on disposable VM','upgrade and post-upgrade validation',
                             'reboot and cold boot persistence','physical P09B and Wi-Fi validation']}
(root/'report.json').write_text(json.dumps(report,indent=2)+'\n')
for item in checks:
    print(item['status']+': '+item['name']+' - '+item['detail'])
print('Release status: candidate; remaining gates are listed in report.json.')
print('IPv6 upstream: '+ipv6['status']+'; no route/RA settings were changed.')
