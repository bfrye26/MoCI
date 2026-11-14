#!/usr/bin/env python3
"""Reconcile every Haven/MoCI version marker to a single release version.

Usage: python3 scripts/sync-version.py 1.0.0-rc.1

Updates the firmware release marker, both OpenWrt package Makefiles, the npm
package version, the frontend cache-buster (ASSET_VER and every ?v= import),
and the upgrade-check fixture version. Image-specific SHA fixtures in
router-upgrade-check.py are intentionally NOT touched here; refresh those from
the built artifact during release validation.
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def main():
    if len(sys.argv) != 2:
        raise SystemExit('usage: sync-version.py <version e.g. 1.0.0-rc.1>')
    version = sys.argv[1].strip()
    m = re.fullmatch(r'(\d+\.\d+\.\d+)(?:-rc\.(\d+))?', version)
    if not m:
        raise SystemExit('version must look like 1.0.0 or 1.0.0-rc.1')
    base, rc = m.group(1), m.group(2)
    release = rc if rc is not None else '1'
    asset = f'{base}r{release}'

    core = ROOT / 'moci/js/core.js'
    core_text = core.read_text(encoding='utf-8')
    old = re.search(r"const ASSET_VER = '([^']+)'", core_text)
    if not old:
        raise SystemExit('ASSET_VER not found in core.js')
    old_asset = old.group(1)

    changed = []

    def replace_in(path, old_str, new_str):
        p = ROOT / path
        text = p.read_text(encoding='utf-8')
        if old_str not in text:
            return
        p.write_text(text.replace(old_str, new_str), encoding='utf-8')
        changed.append(path)

    # Frontend cache-buster: constant + every ?v= import across the SPA.
    if old_asset != asset:
        for p in [ROOT / 'moci/index.html', *sorted((ROOT / 'moci/js').rglob('*.js'))]:
            text = p.read_text(encoding='utf-8')
            if old_asset in text:
                p.write_text(text.replace(old_asset, asset), encoding='utf-8')
                changed.append(str(p.relative_to(ROOT)))

    # Firmware release marker.
    rel = ROOT / 'firmware/files/etc/moci-release'
    rel.write_text(f'MOCI_VERSION={version}\nMOCI_STATUS=release-candidate\n', encoding='utf-8')
    changed.append('firmware/files/etc/moci-release')

    # OpenWrt package versions.
    for mk in ('Makefile', 'integrations/docker-manager/moci-app-docker/Makefile'):
        p = ROOT / mk
        text = p.read_text(encoding='utf-8')
        text = re.sub(r'PKG_VERSION:=[^\n]+', f'PKG_VERSION:={base}', text, count=1)
        text = re.sub(r'PKG_RELEASE:=[^\n]+', f'PKG_RELEASE:={release}', text, count=1)
        p.write_text(text, encoding='utf-8')
        changed.append(mk)

    # npm package version (targeted replace to preserve file formatting).
    pj = ROOT / 'package.json'
    text = pj.read_text(encoding='utf-8')
    text = re.sub(r'("version"\s*:\s*")[^"]+(")', rf'\g<1>{version}\g<2>', text, count=1)
    pj.write_text(text, encoding='utf-8')
    changed.append('package.json')

    # Upgrade-check fixture version (SHAs refreshed separately at validation).
    replace_in('scripts/router-upgrade-check.py',
               re.search(r"VERSION='([^']+)'", (ROOT / 'scripts/router-upgrade-check.py').read_text(encoding='utf-8')).group(0),
               f"VERSION='{version}'")

    print(f'version={version} base={base} release={release} asset={asset} (was {old_asset})')
    print('updated:')
    for c in sorted(set(changed)):
        print('  ' + c)


if __name__ == '__main__':
    main()