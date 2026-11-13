"""Temporary LAN client checks. No UCI writes, host routes, reboot or package installation."""
import ipaddress
import json
import os
from pathlib import Path
import re
import shutil
import signal
import subprocess
import sys
import time
import uuid


def run(args, timeout=15):
    result = subprocess.run(args, capture_output=True, text=True, timeout=timeout)
    if result.returncode:
        raise RuntimeError(f'{args[0]} exited {result.returncode}: {result.stderr[-500:]}')
    return result.stdout


def validate_lease(path, router):
    fields = path.read_text().splitlines()
    if len(fields) != 5:
        raise RuntimeError('DHCP did not provide a complete lease')
    address, mask, gateways, dns, server = fields
    interface = ipaddress.IPv4Interface(f'{address}/{mask}')
    if router not in [ipaddress.IPv4Address(x) for x in gateways.split()]:
        raise RuntimeError('DHCP did not advertise the tested router as the gateway')
    if router not in interface.network or interface.ip == router:
        raise RuntimeError('DHCP address is outside the router subnet or duplicates the router')
    servers = [str(ipaddress.IPv4Address(x)) for x in dns.split()]
    if not servers:
        raise RuntimeError('DHCP did not advertise DNS')
    return {'address':str(interface.ip), 'prefix':interface.network.prefixlen,
            'gateway':str(router), 'dns':servers, 'dhcp_server':server}


def main():
    os.umask(0o077)
    output = Path(__file__).resolve().parent
    report = {'schema':1, 'generated_utc':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),
              'release_ready':False, 'scope':'Independent network namespace attached to the real LAN bridge',
              'checks':[], 'wan_isolation':'NOT_TESTED: requires an external WAN-side client',
              'physical_client':'NOT_TESTED', 'cleanup':'NOT_NEEDED'}
    suffix = uuid.uuid4().hex[:8]
    namespace, host, client = 'moci-test-'+suffix, 'mt'+suffix, 'mc'+suffix
    lease_path, hook = output/'client-lease.txt', output/'dhcp-hook.sh'
    made_namespace = made_link = False

    def record(name, detail):
        report['checks'].append({'name':name,'status':'PASS','detail':detail})

    def interrupted(signum, frame):
        raise InterruptedError(f'Interrupted by signal {signum}')

    for sig in (signal.SIGTERM, signal.SIGINT, signal.SIGHUP):
        signal.signal(sig, interrupted)
    try:
        if os.geteuid() != 0:
            raise RuntimeError('Run on the lab router as root')
        for command in ('ip','ubus','udhcpc','ping','nslookup'):
            if not shutil.which(command):
                raise RuntimeError('Required command missing: '+command)
        run(['ip','netns','list'])
        status = json.loads(run(['ubus','call','network.interface.lan','status']))
        bridge = status.get('l3_device','')
        if not status.get('up') or not re.fullmatch(r'[A-Za-z0-9_.-]{1,15}',bridge):
            raise RuntimeError('LAN is not up with a valid device')
        if not (Path('/sys/class/net')/bridge/'bridge').is_dir():
            raise RuntimeError('LAN device is not a bridge; no network changes attempted')
        router = ipaddress.IPv4Address(status['ipv4-address'][0]['address'])
        report['lan_device'], report['router'] = bridge, str(router)
        # The hook runs inside the namespace. It never writes /etc/resolv.conf.
        hook.write_text('''#!/bin/sh
set -eu
case "$1" in
  bound|renew)
    ip addr flush dev "$interface"
    ip addr add "$ip/$subnet" dev "$interface"
    ip route replace default via "${router%% *}" dev "$interface"
    printf '%s\\n' "$ip" "$subnet" "$router" "$dns" "${serverid:-unknown}" > "$MOCI_LEASE_FILE"
    ;;
esac
''')
        hook.chmod(0o700)
        run(['ip','netns','add',namespace]); made_namespace = True
        run(['ip','link','add',host,'type','veth','peer','name',client]); made_link = True
        run(['ip','link','set',client,'netns',namespace])
        run(['ip','link','set',host,'master',bridge])
        run(['ip','link','set',host,'up'])
        prefix = ['ip','netns','exec',namespace]
        run(prefix+['ip','link','set','lo','up'])
        run(prefix+['ip','link','set',client,'up'])
        os.environ['MOCI_LEASE_FILE'] = str(lease_path)
        dhcp = prefix+['udhcpc','-f','-n','-q','-t','4','-T','3','-i',client,'-s',str(hook)]
        run(dhcp,20)
        lease = validate_lease(lease_path,router)
        record('client-dhcp',lease)
        # A second acquisition uses the same client/MAC and requests its lease.
        lease_path.unlink()
        run(dhcp+['-r',lease['address']],20)
        record('client-dhcp-reacquisition',validate_lease(lease_path,router))
        routes = run(prefix+['ip','-4','route','show','default'])
        if not re.search(r'^default via '+re.escape(str(router))+r'\s',routes,re.M):
            raise RuntimeError('Client default route is not through the router')
        record('client-default-route',routes.strip())
        dns_output = run(prefix+['nslookup','openwrt.org',str(router)],12)
        if 'openwrt.org' not in dns_output:
            raise RuntimeError('Router DNS query returned no matching answer')
        record('client-router-dns','openwrt.org resolved through '+str(router))
        for server in lease['dns']:
            run(prefix+['nslookup','openwrt.org',server],12)
        record('client-advertised-dns','DHCP-advertised DNS servers answered')
        ping_output = run(prefix+['ping','-c','5','-W','2','1.1.1.1'],15)
        if not re.search(r'\b0% packet loss',ping_output):
            raise RuntimeError('Client upstream ping had packet loss')
        record('client-ipv4-forwarding','Five probes from isolated LAN client through router gateway; 0% loss')
    except Exception as error:
        report['checks'].append({'name':'client-test','status':'FAIL','detail':str(error)})
    finally:
        errors = []
        for needed, command in ((made_link,['ip','link','delete',host]),
                                (made_namespace,['ip','netns','delete',namespace])):
            if needed:
                try:
                    run(command)
                except Exception as error:
                    errors.append(str(error))
        report['cleanup'] = 'FAIL: '+'; '.join(errors) if errors else 'PASS'
        if errors:
            report['checks'].append({'name':'cleanup','status':'FAIL','detail':errors})
        report['client_checks_passed'] = bool(report['checks']) and all(c['status']=='PASS' for c in report['checks'])
        (output/'client-report.json').write_text(json.dumps(report,indent=2)+'\n')
        print(json.dumps(report,indent=2))
    return 0 if report['client_checks_passed'] else 1


if __name__ == '__main__':
    sys.exit(main())
