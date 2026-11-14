import importlib.util
import io
import json
import os
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock,patch

spec=importlib.util.spec_from_file_location('fresh',Path(__file__).parents[1]/'scripts/router-cleaninstall-check.py')
fresh=importlib.util.module_from_spec(spec);spec.loader.exec_module(fresh)
LAN='080027439dd1';WAN='08002787bf53'


class FreshInstallChecks(unittest.TestCase):
    def mapping(self,folder,expected_lan=LAN,expected_wan=WAN,wan_device='eth1'):
        root=Path(folder)
        port=root/'br-lan/brif/eth0';port.mkdir(parents=True,exist_ok=True)
        member=root/'eth0';member.mkdir(exist_ok=True)
        (member/'address').write_text('08:00:27:43:9d:d1')
        uplink=root/'eth1';uplink.mkdir(exist_ok=True)
        (uplink/'address').write_text('08:00:27:87:bf:53')
        def query(args):
            if args[0]=='uci': return 'dhcp'
            if 'network.interface.lan' in args:
                return json.dumps({'up':True,'l3_device':'br-lan','ipv4-address':[{'address':'192.168.50.1','mask':24}]})
            return json.dumps({'up':True,'l3_device':wan_device})
        return fresh.check_mapping(expected_lan,expected_wan,query,root)

    def test_expected_installer_mac_mapping_passes(self):
        with tempfile.TemporaryDirectory(dir=Path(__file__).parent) as folder:
            self.assertEqual(self.mapping(folder)['wan_device'],'eth1')

    def test_reversed_installer_mapping_is_refused(self):
        with tempfile.TemporaryDirectory(dir=Path(__file__).parent) as folder:
            with self.assertRaisesRegex(RuntimeError,'LAN does not contain'):
                self.mapping(folder,WAN,LAN)

    def test_wrong_wan_mac_is_refused(self):
        with tempfile.TemporaryDirectory(dir=Path(__file__).parent) as folder:
            with self.assertRaisesRegex(RuntimeError,'WAN does not use'):
                self.mapping(folder,LAN,'001122334455')

    def test_invalid_wan_device_cannot_be_used_as_a_path(self):
        with tempfile.TemporaryDirectory(dir=Path(__file__).parent) as folder:
            with self.assertRaisesRegex(RuntimeError,'Unexpected LAN bridge or WAN'):
                self.mapping(folder,wan_device='../../etc/shadow')

    def test_capacity_refuses_small_or_unexpanded_root(self):
        disk=64*1024**3;partition=disk-17*1024**2
        fresh.verify_capacity(partition,int(partition*.98),disk)
        for part,filesystem in ((8*1024**3,8*1024**3),(partition,8*1024**3),(partition,disk+1)):
            with self.assertRaises(RuntimeError): fresh.verify_capacity(part,filesystem,disk)

    def test_identity_failure_stops_before_other_checks(self):
        with tempfile.TemporaryDirectory(dir=Path(__file__).parent) as folder:
            forbidden=Mock()
            helper={'identify':Mock(side_effect=RuntimeError('Identity mismatch')),'verify_storage_image':forbidden}
            args=SimpleNamespace(expect_hardware_uuid='wrong',expect_lan_mac=LAN,expect_wan_mac=WAN,expect_disk_bytes=64*1024**3)
            old=os.umask(0o077)
            try:
                with patch.object(fresh,'__file__',str(Path(folder)/'test.py')), patch.object(fresh.argparse.ArgumentParser,'parse_args',return_value=args), patch.object(fresh.runpy,'run_path',return_value=helper), patch('sys.stdout',new_callable=io.StringIO):
                    self.assertEqual(fresh.main(),1)
                forbidden.assert_not_called()
                self.assertFalse(json.loads((Path(folder)/'cleaninstall-report.json').read_text())['success'])
            finally: os.umask(old)


if __name__=='__main__': unittest.main()
