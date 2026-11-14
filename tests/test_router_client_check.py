import importlib.util
from pathlib import Path
import tempfile
import unittest
import ipaddress

spec = importlib.util.spec_from_file_location('router_client_check', Path(__file__).parents[1]/'scripts/router-client-check.py')
client = importlib.util.module_from_spec(spec)
spec.loader.exec_module(client)


class LeaseValidation(unittest.TestCase):
    def parse(self, text):
        with tempfile.TemporaryDirectory(dir=Path(__file__).parent) as root:
            path = Path(root)/'lease'
            path.write_text(text)
            return client.validate_lease(path, ipaddress.IPv4Address('192.168.50.1'))

    def test_valid_lease(self):
        lease = self.parse('192.168.50.167\n255.255.255.0\n192.168.50.1\n192.168.50.1\n192.168.50.1\n')
        self.assertEqual(lease['address'], '192.168.50.167')
        self.assertEqual(lease['prefix'], 24)

    def test_wrong_gateway(self):
        with self.assertRaisesRegex(RuntimeError, 'gateway'):
            self.parse('192.168.50.167\n255.255.255.0\n192.168.50.2\n192.168.50.1\n192.168.50.1\n')

    def test_router_address_conflict(self):
        with self.assertRaisesRegex(RuntimeError, 'duplicates'):
            self.parse('192.168.50.1\n255.255.255.0\n192.168.50.1\n192.168.50.1\n192.168.50.1\n')

    def test_wrong_subnet(self):
        with self.assertRaisesRegex(RuntimeError, 'outside'):
            self.parse('192.168.51.167\n255.255.255.0\n192.168.50.1\n192.168.50.1\n192.168.50.1\n')

    def test_missing_dns(self):
        with self.assertRaisesRegex(RuntimeError, 'DNS'):
            self.parse('192.168.50.167\n255.255.255.0\n192.168.50.1\n\n192.168.50.1\n')


if __name__ == '__main__':
    unittest.main()
