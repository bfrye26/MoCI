# MoCI installed-VM validation, November 12, 2026

Firmware source: `45f23be12abec6dfbd16bc71e739c4203ad375b8`.
Local build: `ship-45f23be12abe-20261112T214853Z`.
Test environment: MoCI3, VirtualBox, x86-64 UEFI, host-only LAN and NAT WAN.

## Observed results

| Check | Result | Evidence and limit |
| --- | --- | --- |
| Firmware integrity | Pass | SHA-256 matches generated checksum; 144,273,798 bytes |
| Installer integrity | Pass | SHA-256 matches generated checksum; 450,963,456 bytes |
| Installer and boot | Pass, user-assisted | User completed installation; installed MoCI dashboard is reachable |
| Windows LAN access | Pass | MoCI login and authenticated dashboard load over HTTPS |
| WAN configuration | Pass, basic | Dashboard reports ONLINE; interface UP with DHCP address on VirtualBox NAT |
| LuCI fallback | Pass, login page | Authorization page loads; no LuCI authentication/settings test performed |
| App catalogue | Pass, basic | 73 entries and 24 candidate recipes shown in installed Store |
| Docker | Pass, basic | Engine 29.6.1, Compose 5.1.4 in installed manifest; running containers visible |
| Uptime Kuma | Pass, basic app lifecycle | Container healthy; authenticated dashboard reachable from Windows after container restart; account/database retained; no monitor workload tested |
| Gotify | Pass, LAN login page | Container healthy and login page reachable from Windows; sign-in, message delivery and persistence remain untested |
| LAN firewall automation | Partial | Live UCI has dedicated bridge zone and destination-specific LAN TCP allow rule; app access works; reboot, removal cleanup and WAN negative tests outstanding |
| UPnP defaults | Pass | Automatic mapping disabled, service not running, zero mappings; no WAN-mapping functionality test |
| Expanded storage | Pass, basic | UI reports 56,368,324,608 total filesystem bytes and 53,225,041,920 free at observation time |

The first browser attempt to Uptime Kuma was refused while first-run setup
was in progress. Later logs showed setup and sign-in had completed before
the observed container restart. Do not describe that restart as a confirmed
repair for a persistent fault. Logs after restart show normal server startup
and successful authentication from the Windows host.

Gotify installation confirmation was rejected by automatic approval review.
No retry was attempted. Subsequent read-only observation showed Gotify was
deployed and healthy, and its login page responded. Do not attribute that
deployment to a successful agent install action. No Gotify logs, generated
passwords, configuration exports or credentials were collected.

## Artifact hashes

Firmware: `254a46db486c5fff404a3dad73a85661155e0167520c432cbba5eaa470d8e36a`.

Installer ISO: `83c03114dff8fc2fe20c2717dbddbfdd62e4cd757b52ced54b9807a6031be68a`.

## Proposed next test batch, awaiting explicit installation approval

Run on MoCI3 only. Review/approve image digests through the existing Store;
allow only the template's router-LAN ports. Preserve existing app data and
credentials. No host-directory or Docker-socket mounts, WAN port publishing,
UPnP enablement or changes to the physical router are proposed.

| App | Router LAN TCP ports | Named persistent volume |
| --- | --- | --- |
| IT Tools | 8081 | None |
| OpenSpeedTest | 3000, 3002 | None |
| CyberChef | 8000 | None |
| Glance | 8088 | glance-config |

Validate initial page access, normal startup, data/config retention where
applicable, and lifecycle firewall reconciliation. Do not mark the remaining
22 recipes field verified based on the two observed apps.

Before a production release, still validate router reboot, automatic app/rule
restoration, stop/remove/network recreation cleanup, WAN isolation, remaining
recipes, responsive layout, firmware upgrade and recovery. This report
supports continued release-candidate testing, not a production-ready claim.

