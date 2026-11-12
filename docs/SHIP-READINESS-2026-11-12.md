# MoCI release readiness, November 12, 2026

Base source: `cce43af9d23f0dcdc0e2eabbb6021b5f6e2901fd` on
`feature/upnp-docker-lan-store-20261112` (draft PR 4).

## This change

The Docker firewall synchronizer now compares the actual UCI configuration
with the last successful sync, rejects device conflicts in every explicit
firewall zone (including wildcard device patterns), refuses pending operator
edits, and serializes discovery and updates with a Linux flock. A failed
update discards its uncommitted UCI changes before restoring the backup.
Old digest-only state files trigger a fresh reconciliation.

These changes do not migrate the temporary rules on the existing VM.
The synchronizer's own lock does not serialize unrelated LuCI/UCI writers;
avoid editing firewall configuration during synchronization.

## Observed lab state

The running MoCi2 VirtualBox VM is available through the Windows browser at
192.168.50.1. MoCI reports Docker 29.6.1, Compose 5.1.4, a valid LAN address
and four running managed stacks. The deployed Store still reports five
reviewed templates, whereas the handoff branch contains 24 candidates.
The Store diagnostics are preflight checks, not end-to-end application tests.

Browser navigation attempts to Uptime Kuma (3001) and Gotify (8084) timed
out. This does not distinguish container startup failures from forwarding
failures. SSH, WSL and VBoxManage access were denied in the development
session. Desktop console access timed out waiting for app approval.
No live files or firewall rules were modified by this change.

## Validation and remaining release gates

- Local Windows: eight firewall regression tests passed; one Linux flock
  test skipped. Service controls JavaScript tests passed. Python helper
  compilation passed.
- Linux CI must run the full Docker contracts, the flock test, JavaScript
  checks, and the production frontend build. Windows cannot execute the
  existing full backend suite because it imports Linux fcntl.
- Inspect current firewall configuration and app-local HTTP/logs before
  changing existing VM rules. Preserve existing app data and passwords.
- Back up the current VM and firewall; migrate only the confirmed temporary
  bridge assignments and test rule described in the handoff.
- Deploy the current addon and synchronizer, validate fw4, and test the four
  installed applications from Windows. Verify WAN isolation and data
  persistence after stop/start, network recreation, and reboot.
- Validate the 24 candidate recipes individually before marking them verified.
- Build a fresh OpenWrt x86-64 UEFI image and installer, then test installation,
  first login, networking, LuCI fallback, upgrade and recovery on a disposable
  VM disk. Do not publish a production release until these gates pass.

## Build on the existing Windows PC

From Windows PowerShell, with this source snapshot at C:\moci-build\MoCI:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File C:\moci-build\MoCI\scripts\Start-MoCI-Ship-Build.ps1 -Mode Firmware -Jobs 20
```

Use `-Mode Check` for prerequisites only, or `-Mode All` for firmware plus
installer ISO. The ISO stage prompts for the existing Ubuntu sudo password.
Both companion scripts must remain in the same directory. The launcher uses
Ubuntu-24.04 by default and accepts `-Distro` for an existing alternate name.

It pins firmware source to the CI-tested commit
`45f23be12abec6dfbd16bc71e739c4203ad375b8`, creates a separate worktree under
~/Projects, and reuses ~/Projects/openwrt compilation outputs when that tree
is clean and its commit matches the v25.12.6 tag. If it differs or has tracked
edits, the launcher preserves it and automatically prepares a separate
~/Projects/openwrt-ship-v25.12.6 checkout. Existing downloaded package archives
are reused when available. Compiled objects from a different release are
not reused, so that first build may take longer. A modified or incomplete
separate checkout is refused without overwriting it.
The original MoCI checkout is preserved. Each run saves its build log, prior
and used OpenWrt configs, source versions and image checksums under a unique
~/Projects/MoCI-output/ship-* directory. It does not flash the VM or any disk.

The Windows launcher passed PowerShell parsing. Full local execution remains
unverified because WSL access is blocked in the agent session. Linux CI also
checks the companion Bash script's syntax; a successful syntax check is not
proof that the firmware or ISO builds successfully on the PC.

The source directory was reconstructed from GitHub through the connected API
because direct Git networking was unavailable. Its local initial commit is a
snapshot, not an ancestor of the upstream Git history. Apply this change via
the upstream pull request or a patch against the base above; do not merge the
local snapshot root into upstream.
