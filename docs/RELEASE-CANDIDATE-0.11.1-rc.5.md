# MoCI 0.11.1-rc.5 validation status

Firmware source: 77ac51bf9c725b89233b441926a4115095e97a96.
OpenWrt source: 64900e756efa667774214f9c6b17c113222e01f7 (v25.12.6).
Build: ship-77ac51bf9c72-20261113T185130Z.
Firmware SHA256: d68a89a508f9c5441ab0cbce9d1c840ef59525062bfa550348e32835606e3de0.

This is a release candidate, not a hardware-qualified release.

## Verified rc.5 upgrade

The disposable VM upgrade passed all ten checks in
artifacts/upgrade-check-20261113T195016Z-0fa51e02/upgrade-post.json:
identity, installed version/runtime helper, installed storage helper and automatic
growth, retained core settings, disabled unconfigured UPS, Docker bridge/reply
policy, container DNS, container HTTP, router/client connectivity and retained
root capacity. Usable root capacity changed from 46,194,810,880 to 46,194,905,088
bytes. The root partition is 47,068,217,344 bytes and resize_inode is absent.
No subsequent offline repair was reported or requested for this upgrade.

The first rc.4 upgrade failed storage capacity and was manually repaired. That
result is separate from this rc.5 upgrade. The rc.5 image was normalized offline
during its build and expanded automatically after installation. Earlier backup
restore and namespace-client tests remain useful component evidence, not proof
that all release gates have passed. release_ready remains false.

## Next lab checks

Test-MoCI-ColdBoot.ps1 requires the matching successful rc.5 upgrade report. It
verifies the original VM is off and the disposable VM has the expected identity,
records the guest boot ID, requests clean power-off, waits for actual power-off,
cold-starts the guest, runs the existing rc.5 router/client/storage verification
and requires a changed guest boot ID. It does not flash firmware, apply repairs,
force a shutdown or change router configuration. Its results are pending live
execution. Passing cold boot does not close the earlier VirtualBox warm-reset
stall or establish physical-hardware reboot reliability.

Remaining release gates include an independent WAN client testing management,
DNS and app isolation; real allow/deny and port-forward traffic tests and cleanup;
management-loss rollback; a clean rc.5 installer run; and physical P09B/J4125 SSD,
six I225-V ports, Wi-Fi chipset/AP capability, throughput, temperatures and boot
behaviour. IPv6 needs a working upstream before routed IPv6 can be validated.

The upgrade runner blocks existing app containers, volumes and stacks because
standard full-image x86 upgrades can overwrite root-resident application data.
Durable app storage/migration remains unresolved and must be addressed before
claiming upgrades preserve installed apps. The installer ISO is for fresh installs
only and must never be used as a sysupgrade payload.
