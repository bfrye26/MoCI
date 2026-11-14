#!/usr/bin/env python3
"""Offline contract tests for the Haven RFC 2136 DNS publisher (no network/root)."""
import runpy
import socket
import struct
import unittest
from pathlib import Path

BASE = Path(__file__).resolve().parents[1]
M = runpy.run_path(str(BASE / 'files/moci-dns-publish'))


def dns_name(name):
    out = b''
    for label in name.split('.'):
        out += bytes([len(label)]) + label.encode()
    return out + b'\x00'


def update_packet(records, zone='lan'):
    # records: list of (name, rtype, rclass, rdata)
    question = dns_name(zone) + struct.pack('!HH', 6, 1)
    answer = b''
    for name, rtype, rclass, rdata in records:
        answer += dns_name(name) + struct.pack('!HHIH', rtype, rclass, 300, len(rdata)) + rdata
    header = struct.pack('!HHHHHH', 0x1234, 0x2800, 1, len(records), 0, 0)  # opcode 5
    return header + question + answer


class DnsPublishContract(unittest.TestCase):
    def test_parse_add_a_record(self):
        pkt = update_packet([('printer.lan', 1, 1, socket.inet_aton('192.168.50.60'))])
        zone, recs = M['parse_update'](pkt)
        self.assertEqual(zone, 'lan')
        self.assertEqual(recs, [{'name': 'printer.lan', 'type': 'A', 'addr': '192.168.50.60', 'action': 'add'}])

    def test_parse_delete_a_record(self):
        pkt = update_packet([('printer.lan', 1, 255, b'')])
        _zone, recs = M['parse_update'](pkt)
        self.assertEqual(recs[0]['action'], 'delete')

    def test_parse_aaaa_record(self):
        addr = socket.inet_pton(socket.AF_INET6, 'fd00::5')
        pkt = update_packet([('host.lan', 28, 1, addr)])
        _zone, recs = M['parse_update'](pkt)
        self.assertEqual(recs[0]['type'], 'AAAA')
        self.assertEqual(recs[0]['addr'], 'fd00::5')

    def test_rejects_non_update(self):
        header = struct.pack('!HHHHHH', 1, 0x0100, 0, 0, 0, 0)  # opcode 0 (QUERY)
        with self.assertRaises(ValueError):
            M['parse_update'](header)

    def test_rejects_truncated(self):
        with self.assertRaises(ValueError):
            M['parse_update'](b'\x00\x01')

    def test_compressed_name_pointer(self):
        # Zone 'lan' at offset 12; record name uses a pointer to it.
        zone = dns_name('lan') + struct.pack('!HH', 6, 1)
        # name = 'host' + pointer to offset 12
        name = b'\x04host' + bytes([0xC0, 12])
        rr = name + struct.pack('!HHIH', 1, 1, 300, 4) + socket.inet_aton('10.0.0.9')
        header = struct.pack('!HHHHHH', 1, 0x2800, 1, 1, 0, 0)
        _zone, recs = M['parse_update'](header + zone + rr)
        self.assertEqual(recs[0]['name'], 'host.lan')

    def test_valid_name_rules(self):
        self.assertEqual(M['valid_name']('printer.lan'), 'printer.lan')
        self.assertEqual(M['valid_name']('printer'), 'printer')
        self.assertIsNone(M['valid_name']('router.lan'))      # reserved
        self.assertIsNone(M['valid_name']('localhost'))        # reserved
        self.assertIsNone(M['valid_name']('evil.com'))         # external domain
        self.assertIsNone(M['valid_name']('-bad.lan'))         # invalid label
        self.assertIsNone(M['valid_name']('a' * 300 + '.lan')) # too long

    def test_apply_records_add_delete_and_cap(self):
        recs = [{'name': 'a.lan', 'type': 'A', 'addr': '10.0.0.1', 'action': 'add'}]
        state = M['apply_records']({}, '10.0.0.2', recs)
        self.assertEqual(state, {'10.0.0.2': {'a.lan/A': '10.0.0.1'}})
        # delete removes the record and the empty publisher
        dele = [{'name': 'a.lan', 'type': 'A', 'addr': '', 'action': 'delete'}]
        state = M['apply_records'](state, '10.0.0.2', dele)
        self.assertEqual(state, {})
        # external names are ignored
        ext = [{'name': 'x.com', 'type': 'A', 'addr': '1.2.3.4', 'action': 'add'}]
        self.assertEqual(M['apply_records']({}, '10.0.0.2', ext), {})

    def test_render_hosts_deterministic(self):
        state = {'10.0.0.2': {'b.lan/A': '10.0.0.3', 'a.lan/A': '10.0.0.4'}}
        text = M['render_hosts'](state)
        self.assertIn('10.0.0.4 a.lan', text)
        self.assertIn('10.0.0.3 b.lan', text)
        self.assertLess(text.index('a.lan'), text.index('b.lan'))

    def test_handle_packet_requires_opt_in(self):
        allow = M['load'](M['ALLOW'], {})
        # With an empty allowlist (default), publishing is refused.
        pkt = update_packet([('x.lan', 1, 1, socket.inet_aton('10.0.0.1'))])
        state, changed = M['handle_packet'](pkt, '10.0.0.99', {})
        self.assertFalse(changed)
        self.assertEqual(state, {})

    def test_prune_keeps_active_leases(self):
        state = {'10.0.0.1': {'a.lan/A': '10.0.0.1'}, '10.0.0.2': {'b.lan/A': '10.0.0.2'}}
        active = M['active_lease_ips']()
        pruned = M['prune'](state)
        if active:
            self.assertTrue(all(ip in active for ip in pruned))
        else:
            self.assertEqual(pruned, state)  # no lease data -> do not prune blindly


if __name__ == '__main__':
    unittest.main(verbosity=2)