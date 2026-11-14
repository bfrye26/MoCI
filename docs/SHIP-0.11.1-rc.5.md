# MoCI 0.11.1-rc.5 — ship record

**Status: validated VM-lab release candidate.** This is shippable for lab/VM use
and for guided physical bring-up. It is **not** a production or hardware-qualified
release. `release_ready` remains `false` until the remaining gates below are closed
on the target hardware.

Prepared 2026-11-13 from the validated source and lab evidence.

## Identity

| Item | Value |
| --- | --- |
| MoCI version | `0.11.1-rc.5` (`MOCI_STATUS=release-candidate`) |
| MoCI source commit | `77ac51bf9c725b89233b441926a4115095e97a96` |
| OpenWrt source | `64900e756efa667774214f9c6b17c113222e01f7` (v25.12.6) |
| Build | `ship-77ac51bf9c72-20261113T185130Z` |
| Firmware image | `openwrt-x86-64-generic-ext4-combined-efi.img.gz` |
| Firmware SHA-256 | `d68a89a508f9c5441ab0cbce9d1c840ef59525062bfa550348e32835606e3de0` |
| Installer ISO | `MoCI-x86-64-UEFI-Installer-UNTESTED.iso` |
| Installer SHA-256 | `7893e733f0be365ad3ce77109513912d7aed1b92799312976d7695a2c1c485e6` |

Both artifact hashes were re-verified against the build `SHA256SUMS` at ship time.
The committed source is byte-identical to the built rc.5 firmware-affecting files
(verified by hash), so these artifacts match the published code. Later commits
(`40fd6c9`, `9cb2fff`) change validation tooling and docs only, not the firmware.

**The installer ISO is for fresh installs only. Never use it as a `sysupgrade`
payload.** Use the `.img.gz` firmware image for upgrades.

## Validated gates (lab evidence)

| Gate | Result | Evidence |
| --- | --- | --- |
| Fresh clean install | PASS, 9/9 checks | `artifacts/cleaninstall-check-20261113T213959Z-5674c728/cleaninstall-report.json` (`success:true`) |
| Full-image upgrade | PASS, 10/10 checks | `artifacts/upgrade-check-20261113T195016Z-0fa51e02/upgrade-post.json` |
| Cold boot | PASS, boot-ID changed | `artifacts/coldboot-check-20261113T200713Z-00551aba/coldboot-report.json` |
| Backup / restore | PASS, content + post-boot | `artifacts/restore-check-20261113T130422Z-571b7390/restore-report.json` |
| Storage growth | PASS, fills disk, `resize_inode` absent | fresh-install + upgrade reports |
| WAN isolation (config) | PASS | WAN zone `input=REJECT`, `forward=DROP`, masq on, zero DNAT/redirects |
| DHCP/DNS, container DNS/HTTP egress | PASS | fresh-install + upgrade reports |
| Offline quality | PASS | 24 Python/Node/shell suites, frontend build, all PowerShell runners parse; GitHub CI green |

Fresh-install checks cover: VM identity, installed version/runtime source, root
expanded+corrected, installer LAN/WAN adapter mapping, disabled unconfigured UPS,
persistent Docker defaults, default-container DNS and HTTP egress, and router plus
isolated namespace-client connectivity.

## Remaining gates (not yet closed)

1. **Management-loss rollback (live drill).** The rollback-safe `uciApplyConfig`
   logic is unit-tested (keep / cancel / unreachable / unrelated-edit /
   denied-apply / denied-confirm all pass in `tests/router-config.test.mjs`), but
   a live browser drill that actually loses and regains management is pending.
2. **Firewall allow/deny and port-forward traffic tests** with real traffic and
   cleanup.
3. **Independent external WAN-client isolation.** Config-level evidence is strong
   (WAN input REJECT, no DNAT), but a literal WAN-side client test is limited by
   the VirtualBox NAT topology.
4. **Durable app-data migration on upgrade.** See constraint below.
5. **Physical P09B/J4125 qualification:** SSD detection, six I225-V ports, Wi-Fi
   chipset/AP capability, 2.5 GbE throughput, temperatures, cold power-on, Secure
   Boot/watchdog. Requires the actual device; see `docs/P09B-HARDWARE-INSTALL.md`.
6. **Routed IPv6** once a working upstream is available.

## Known constraints (documented, not silently shipped around)

- **Full-image x86 upgrades do not preserve root-resident app data.** The pinned
  OpenWrt x86 platform upgrade rewrites the root partition; the standard config
  backup does not carry Docker app data under root. The upgrade runner therefore
  permits only an empty-app disposable VM. A durable app-data layout/migration is
  unresolved and must be addressed before claiming upgrades preserve installed
  apps. Fresh installs preserve apps normally.
- **VirtualBox UEFI warm-reset stall** is a harness/hypervisor observation, not a
  firmware defect; cold boot is validated. Physical reboot reliability is not
  established by VM testing.
- **Installer ISO is fresh-install only** (repeated for safety).

## Fixes made while completing validation this session

- **Fresh-install boot blocker:** the clean-install VM had CPU APIC disabled
  (`apic=off`), preventing 64-bit boot. Set the CPU/clock profile to match the
  known-good router (`--apic on --ioapic on --x86-pae on --x86-x2apic off
  --paravirt-provider none`) and cold-started the installed disk. Boots cleanly.
- **Validation tooling (commit `40fd6c9`):** legacy `scp -O` stored Windows
  backslash source paths under their full path on the guest (basename splits on
  `/`); all uploads now use forward slashes. The clean-install MAC-mapping check
  read `brif/<port>/address`, which bridge-port sysfs does not expose; it now reads
  `/sys/class/net/<port>/address`. Regression test updated to the real layout.

## Install / upgrade guidance

- **Fresh install:** boot the installer ISO in UEFI mode, select the target disk
  and the WAN/LAN adapters by MAC, set LAN IP (default `192.168.50.1/24`) and a
  unique root password. After install, remove the ISO and boot the disk. The root
  filesystem expands to fill the disk automatically on first boot.
- **Upgrade:** use the `.img.gz` firmware image via `sysupgrade` on an empty-app
  system, after a verified private backup. Do not upgrade with installed app data
  until durable migration is resolved.
- **Recovery:** guarded offline root-repair and storage-recovery helpers are in
  `scripts/` (`moci-offline-root-repair.sh`, `Start-MoCI-Storage-Recovery.ps1`).

## Reproduce the validation

```powershell
# disposable clone, then guarded tests (original VM stays off)
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\New-MoCI-ValidationVM.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\Test-MoCI-Upgrade.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\Test-MoCI-Restore.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\Test-MoCI-ColdBoot.ps1
# fresh clean-install VM + validation
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\New-MoCI-CleanInstallVM.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\Test-MoCI-CleanInstall.ps1
```

Offline suites: `python3 tests/docker-store-contract.py`,
`python3 tests/docker-firewall-reconcile.py`, the `tests/test_*check.py` and
storage/runtime suites, and the `tests/*.test.mjs` Node suites; `npm run build`.
