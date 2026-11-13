# Core router readiness

The release priority is reliable firmware. Additional one-click applications are deferred.

## Observed in the current VM

- Authenticated MoCI navigation works after user sign-in.
- LAN 192.168.50.1 is up; WAN DHCP has 10.0.3.15 on VirtualBox NAT.
- Router DNS resolved openwrt.org through 127.0.0.1.
- Five router-originated pings to 1.1.1.1 succeeded with 0% loss.
- LAN DHCP pool starts at 100, has 150 addresses and a 12-hour lease; WAN DHCP serving is disabled.
- Client lease 192.168.50.167 is visible. The handoff records its prior active DHCP/DNS test.
- The first core UI update was installed by the user and exercised live.
- Temporary DNS record moci-release-check.lan resolved to 192.0.2.123, then 192.0.2.124 after editing. After deletion, a fresh router DNS query returned NXDOMAIN.
- Reserving the existing test client lease changed its control to Edit reservation. dnsmasq picked up the temporary hostname moci-lease-check. The reservation was then deleted and the UI returned to No static leases. A fresh client lease acquisition was not performed in this session.
- Cancelling confirmation for a temporary 192.0.2.0/24 route left the route visible in the session configuration after the timeout. This does not by itself distinguish active routing from restored staging. The test route was subsequently removed through the UI and its removal explicitly confirmed; the final view showed no static routes.
- After the user applied the follow-up update and restored sign-in, another unconfirmed test-route attempt was made. A fresh configuration load showed no static routes. No kernel route inspection or deliberately disconnected-client test was performed, so the broader recovery gate remains open.
- Backup generation was attempted once through the UI, but browser download observation timed out and reset its control session. No matching backup archive was found in the user's default Downloads folder. Backup download success remains unverified; do not treat the control timeout as proof of router or backup-command failure.
- Subsequently, the command-line runner completed all seven checks successfully: LAN/WAN, router DNS, five upstream pings, fw4 syntax, WAN default policies and backup archive integrity. The 23,338-byte private backup was downloaded and its SHA-256 matched the router-provided digest. Backup restore and the browser download path remain separate unverified gates.
- The user reported a successful rc.2 firmware/ISO build in /home/bfrye26/Projects/MoCI-output/ship-01c164c69030-20261113T044108Z. Its source prefix matches the CI-passing pin. The agent could not access that WSL export; artifact checksums must still be verified using scripts/Copy-MoCI-Candidate.ps1 on Windows.
- Backup/Restore currently offers backup generation and reset, but no restore control.
- Docker's default interface is down; the handoff records working managed bridges and an unresolved default docker0 issue.

These observations do not establish client forwarding, external WAN isolation, upgrade recovery or hardware reliability.

## Core fixes prepared

- UCI set/add/delete/commit reject nonzero or missing RPC status instead of announcing success.
- Checkbox options round-trip as UCI 1/0 strings.
- DHCP pool and DNS edits reload the appropriate services; failed reloads are reported separately from successful saves.
- Interface, route, device, bridge, firewall and wireless edits use rpcd timed apply without an earlier commit. An explicit user confirmation follows a reachability check. Unconfirmed changes are left for server-side rollback.
- Timed apply refuses to include pending changes from a different configuration and blocks additional wrapper writes while confirmation is pending.
- Follow-up correction: when cancellation or failed confirmation occurs after apply, request immediate rpcd rollback and then discard this configuration's restored staging delta. If recovery cannot be acknowledged, report that staged edits require review instead of claiming cleanup. The correction has regression tests but is not yet deployed or live-verified.
- Firmware selection invalidates old validation, supports x86 .img/.img.gz, rejects installer ISOs, checks every upload chunk and requires an explicit successful sysupgrade test before enabling Flash.
- Upgrade command failures and disconnected sessions are reported honestly; reboot success is not assumed.

## Apply to the existing 0.11.x lab VM

The first update was installed and live-tested. The follow-up rollback/staging correction requires another application of the updated helper. Direct SSH remains unavailable to the agent. Run:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File C:\moci-build\MoCI\scripts\Apply-MoCI-Core-Fixes.ps1
```

The script copies the built core/network/system JavaScript and index HTML, verifies staging checksums, backs up installed files under /root/moci-core-backup-TIMESTAMP, preserves existing ACL entries while adding uci.changes and the rollback/revert methods, and reloads rpcd. It does not change UCI network settings or flash a disk. Reload the browser with Ctrl+F5 and sign in if needed.

## Required before release

### Follow-up live checks, 2026-11-13

Browser control reconnected. A fresh dashboard load showed the corrected UTF-8 symbols, LAN 192.168.50.1, WAN 10.0.3.15 and updated system statistics. The diagnostics page returned five upstream pings with 0% loss and resolved openwrt.org through 127.0.0.1. This is router-originated evidence only.

Backup generation emitted Saving config files in the router log, but no new download was verified. The IPv6 no-default-route warning remains visible. Neither observation proves a failure of IPv4 routing.

A direct dashboard load exposed unbound quick-action buttons. They were registered only when SystemModule opened its page. DashboardModule now owns these handlers at construction, while SystemModule no longer adds duplicates. The new regression test covers direct dashboard initialization, cancellation, rejected commands and duplicate in-flight requests. Local tests and frontend build passed. This follow-up is prepared in source and built UI files; it still requires application to the lab VM. The attempted reboot did not execute, so reboot persistence remains unverified.

| Gate | Evidence required |
| --- | --- |
| Settings activation | Create/edit/delete DNS entries and DHCP reservations; independently query the router and renew the client lease |
| Network recovery | Keep one harmless interface change, cancel another, and verify automatic rollback after a deliberately lost management connection in a disposable VM |
| Client routing | Separate LAN client obtains DHCP/DNS and reaches upstream IPv4 through NAT; verify IPv6 only when the upstream provides it |
| WAN isolation | Independent client on the WAN segment cannot reach management, DNS or app ports unless a rule was explicitly created |
| Firewall controls | Traffic-rule and forwarding changes have their intended effect; removal closes access; rules survive reboot |
| Backup and recovery | Restore a generated backup on a disposable VM and verify LAN/WAN, DHCP/DNS and administrative access |
| Upgrade | Upgrade a cloned VM using a checksum-verified image, verify settings retention, installed version and recovery from a failed validation |
| Reboot | Confirm client routing and configuration persist across reboot and cold boot |
| Hardware | P09B/J4125 boot, SSD, six I225-V ports/MAC mapping, load/temperature and exact Wi-Fi chipset/AP capability |

Do not mark these gates passed based on static tests, router-self probes or the existence of UI controls. A new firmware image must include the final tested source and be verified independently of this live UI update.
