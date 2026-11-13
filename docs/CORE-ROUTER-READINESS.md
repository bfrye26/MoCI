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

### LAN-client test runner

Run on the Windows build PC against the lab VM:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File C:\moci-build\MoCI\scripts\Test-MoCI-Client.ps1
```

This uploads scripts/router-client-check.py using normal SSH host verification. It creates a temporary namespace and veth on the existing LAN bridge, obtains a real DHCP lease, reacquires it with the same client, checks the advertised gateway and DNS, queries DNS from that client and sends five upstream probes through the router. It does not modify UCI, Windows routes or resolv.conf, install packages, reboot or flash firmware. The temporary network devices are removed on completion or handled interruption; cleanup failures prevent a pass. A forcibly killed process or router crash can interrupt cleanup. The client lease can remain in dnsmasq until expiry.

Reports are saved under artifacts/client-check-TIMESTAMP/client-report.json. Missing namespace/veth support is reported as a failed precondition instead of substituting router-self probes. DHCP reacquisition is not a timed lease-renewal test. Namespace tests do not establish physical NIC performance. WAN isolation remains NOT_TESTED because VirtualBox per-VM NAT has no independent WAN peer in the current setup.

Python compilation, five lease-validation regression cases and PowerShell syntax checks passed locally. Live client results are pending execution on the router; this runner does not set release_ready true.

Live execution subsequently passed at 2026-11-13T12:44:50Z. Report: artifacts/client-check-20261113T124440Z-4ca3ea4c/client-report.json. The isolated LAN client obtained and reacquired 192.168.50.169/24 from 192.168.50.1, received that router as its gateway and DNS, resolved openwrt.org, and received five upstream ping replies with 0% loss. All six checks and cleanup passed. This closes the namespace-client IPv4 forwarding check. External WAN isolation, physical client behavior, timed DHCP renewal, restore and upgrade remain unverified; release_ready remains false.

### Follow-up live checks, 2026-11-13

Browser control reconnected. A fresh dashboard load showed the corrected UTF-8 symbols, LAN 192.168.50.1, WAN 10.0.3.15 and updated system statistics. The diagnostics page returned five upstream pings with 0% loss and resolved openwrt.org through 127.0.0.1. This is router-originated evidence only.

Backup generation emitted Saving config files in the router log, but no new download was verified. The IPv6 no-default-route warning remains visible. Neither observation proves a failure of IPv4 routing.

A direct dashboard load exposed unbound quick-action buttons. They were registered only when SystemModule opened its page. DashboardModule now owns these handlers at construction, while SystemModule no longer adds duplicates. The new regression test covers direct dashboard initialization, cancellation, rejected commands and duplicate in-flight requests. Local tests and frontend build passed. This follow-up is prepared in source and built UI files; it still requires application to the lab VM. The attempted reboot did not execute, so reboot persistence remains unverified.

The user subsequently applied this update. The live Reboot action opened its confirmation and returned the acknowledged Reboot requested message. Management then became unreachable while recovery was being checked. Do not mark persistence passed until fresh post-boot status and diagnostics are recorded. Full Linux CI passed for source 8316245becc890824c3ea7300606392bb219ddc5: https://github.com/bfrye26/MoCI/actions/runs/43424617648. The next firmware build is pinned to this tested source, including the dashboard fix.

Post-reboot recovery was subsequently verified through the authenticated UI. Dashboard uptime reset to 0d 0h 0m, hostname remained moci-router, LAN remained 192.168.50.1 and WAN DHCP returned 10.0.3.15. Fresh diagnostics resolved openwrt.org through 127.0.0.1 and received all five upstream ping replies with 0% loss. The user reported the VM was back before these checks; any intervening manual recovery steps are unknown. This establishes post-boot router connectivity, not unattended reboot reliability, client forwarding or cold-boot persistence.

The new boot log again exposed nut-server repeatedly exiting because no UPS is configured. Existing first-boot defaults do not guard this optional service. This remains a clean-install defect to address; do not disable configured UPS deployments. The IPv6 default-route warning and default docker interface DOWN state remain separate observations.

The user clarified that VirtualBox did not complete the restart. Host VBox.log.1 records ACPI: Reset initiated by ACPI at elapsed 07:31:20, followed by RESETTING -> RUNNING and UEFI initialization. UEFI trace stops after loading PciHostBridgeDxe.efi at 07:31:23; no subsequent bootloader loads are logged before the GUI power-off at 07:34:03. A separate powered-on session then boots successfully. This points to a VirtualBox UEFI warm-reset stall before guest boot, rather than the dashboard failing to send a reboot. It does not establish the root cause or physical-hardware reboot behavior. Unattended reboot remains unverified/failing in this VM configuration.

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
