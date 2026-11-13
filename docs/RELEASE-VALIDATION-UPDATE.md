# Release validation update
Prepared November 12, 2026. Target: P09B/J4125, six Intel I225-V ports, SATA/mSATA and an unidentified mini-PCIe Wi-Fi module.

## Completed
- Original firmware and installer checksums matched.
- User completed a fresh UEFI installation in MoCI3.
- MoCI authenticated dashboard and LuCI login page were reached from Windows.
- WAN interface/dashboard reported online on VirtualBox NAT.
- Uptime Kuma dashboard and retained account were observed after container restart.
- Gotify container was healthy and its login page was reachable.
- IT Tools was installed under the user's explicit test approval, reached from Windows, and correctly converted MoCI to TW9DSQ==.
- Live UCI contained destination-specific LAN Docker rules. UPnP was disabled with zero leases.
- The original manifest included igc for the Intel I225 wired interfaces.
- Updated source passed Linux CI, including 27 Store contracts, nine firewall regression tests, 41 Docker integration tests, session-expiry and service tests, frontend build, shell syntax and source-selection checks.

## Source changes prepared for the next candidate
- Correct expired-login handling with a session-validity probe; valid-session ACL failures and network failures do not force logout.
- Duplicate navigation listeners are prevented after signing in again.
- Hardware inventory in the live installer and installed firmware.
- Installer WAN/LAN selection excludes wireless and virtual interfaces.
- Explicit wired driver, microcode, CPU temperature and device-inventory package selection.
- Modern Docker no-new-privileges option syntax.
- Accurate AdGuard manual-setup flag and expanded CI coverage.

## Not completed
OpenSpeedTest installation was attempted, but browser control stalled during confirmation and the service connection was refused at the last observation. Do not claim it installed. CyberChef and Glance were not installed in this test batch.

Full router reboot, lifecycle rule cleanup, WAN-side negative tests, a separate DHCP/DNS client, responsive screenshots, upgrade and recovery have not been verified. The new 0.11.1 source has not been built into a firmware image or ISO yet. The previously built artifacts still contain source 45f23be.

Wi-Fi chipset, driver and AP mode remain unidentified/unverified. Physical boot, all six links, disk detection, thermal performance and cold-power-on require the actual PC.

## Session blockers
Browser automation stopped responding to a focus command. On a later attempt its runtime failed to start because a Linux skill path was present in the Windows configuration. Native command execution also rejected /workspace as an invalid Windows permission path. Workspace file operations and local Node tests remain available through the JavaScript runtime, and GitHub CI remains available.

No physical disk was flashed and no changes were made to the production router. These are documented blockers, not passed release gates.
