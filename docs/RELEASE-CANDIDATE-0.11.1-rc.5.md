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

The first rc.5 cold-boot test confirmed guest power-off, then VirtualBox rejected
startvm because its GUI session was still locked. This is a harness timing issue,
not evidence of a guest cold-boot failure. The retry now rechecks VM identity and
power-off before every attempt and retries only that exact session-lock error for
up to 60 seconds. Other failures stop immediately. Use -Resume with the test VM
still off to retain the original guest boot-ID baseline. No processes are killed,
locks removed, forced shutdowns performed or firmware flashed. Mocked retry/guard
checks and PowerShell syntax validation passed; the live resume remains pending.

The resumed test subsequently passed. Its original guest boot ID
7e1cb973-7f1e-4085-a429-5bd4bdaffed3 changed to
4430e428-ea8b-479d-9ff2-84e84d7b6904. The report in
artifacts/coldboot-check-20261113T200713Z-00551aba/coldboot-report.json confirms
power-off, cold start and rc.5 router/client/storage checks. This closes the
tested VM cold-boot gate. The original session-lock race remains part of the
harness history, and physical hardware/warm-reset reliability is not established.

## Fresh-installer test preparation

New-MoCI-CleanInstallVM.ps1 verifies the exact rc.5 image and installer hashes,
creates a separate UEFI VM with a single new dynamically allocated 64 GiB SATA
disk and two Ethernet adapters, and records its UUID and LAN/WAN MACs. It reuses
the established host-only LAN and NAT WAN topology without changing Windows
network settings. Only after preparing the new VM does it request a guarded,
clean shutdown of the working upgrade-test VM, which is preserved with its disk
and snapshots. The original MoCI3 must remain off. The new VM starts only after
both older routers are confirmed off to avoid duplicate gateway IPs.

The installer must select the blank 64 GiB disk, WAN and LAN by the displayed MACs,
LAN IP 192.168.50.1, hostname and root password. After successful installation,
Quit the installer and run sudo poweroff. Complete-MoCI-CleanInstall.ps1 verifies
all VM identities/states, ejects only the new VM's ISO and boots its installed disk.
It retries only the known VirtualBox session-unlock race. Neither launcher deletes
VMs, attaches an existing router disk to the new VM or marks installation passed.

Both launchers passed PowerShell syntax checks; their VirtualBox create/attach
execution and the fresh rc.5 installation remain pending live validation. Installer
ISO SHA256: 7893e733f0be365ad3ce77109513912d7aed1b92799312976d7695a2c1c485e6.

The created VM is MoCI-Clean-Install-20261113-202520, UUID
188a4a38-bab8-4a3f-99c6-22e238808b0b, with LAN MAC 080027439dd1 and WAN MAC
08002787bf53. Its initial Debian live boot displayed RCU/timer, udev, ATA and
vmwgfx warnings. The disk still had zero allocated data blocks at that inspection.
The user then reported that installation progressed and the installed router was
back online. No compatibility-profile change or forced restart was executed by
the agent. The cause of the transient live-boot stall remains unknown.

Test-MoCI-CleanInstall.ps1 validates this recorded VM with both preserved VMs off
and installer media ejected. A separate per-VM SSH trust file/alias preserves the
older VMs' keys. The first connection uses the normal SSH trust prompt. The guest
helper checks identity before firmware/runtime checks, exact rc.5 helper sources,
corrected ext4 metadata and a partition/filesystem filling the 64 GiB disk, recorded
LAN/WAN adapter MAC mapping and LAN address, disabled unconfigured UPS, persistent
Docker defaults, container DNS/HTTP and the existing router and namespace-client
tests. The fresh private settings backup is downloaded and checksum verified.
This verifier applies no firmware or runtime repairs and changes no UCI settings.
Six identity/mapping/capacity safeguard tests, the nine upgrade safeguard tests,
Python compilation and PowerShell syntax checks passed locally. Live fresh-install
validation remains pending; online management alone is not a complete pass.

The first fresh-install validation stopped at its host-side media guard. The
completion command had detached the DVD device entirely (`--medium none`), while
the verifier accepted only an empty attached DVD drive. Inspection of current VM
XML confirmed no DVD image/device. The verifier now accepts either explicit empty
or removed slots, or checks current VM XML when the slot is omitted. Attached ISO
paths and unverifiable state still fail, and identity/state checks remain strict.
Future completion retains an empty drive with `--medium emptydrive`. Regression
checks for detached/attached/unknown media and snapshot isolation passed. No router
validation ran during the failed host guard, and the VM was not restarted.

## Fresh-VM boot timing investigation

The fresh installed VM subsequently showed large kernel timestamp jumps and
incomplete boot. Its VBox log uses the KVM paravirtualization provider under NEM
and reports a rejected RealTSCOffset mode switch. The successfully tested older
VM instead uses provider None, PAE enabled and x2APIC disabled. These differences
suggest a compatibility experiment; they do not by themselves establish causation
or prove a firmware filesystem fault. Fresh-install validation remains incomplete.

Repair-MoCI-CleanInstallClock.ps1 verifies the fresh VM and both preserved VMs,
saves host-side settings/logs and requires a successful recovery snapshot before
requesting shutdown. Without -RecoverStalledBoot it stops if the guest fails to
shut down. With that explicit switch it can power off only the snapshotted stalled
fresh VM after an ACPI timeout, then select provider None, disable x2APIC and enable
PAE while powered off, and start the same installed disk. No image is reflashed,
disk formatted or host Hyper-V/WSL/security configuration changed. A forced stop,
if needed, is recorded and is not a graceful-shutdown pass. The new-VM launcher
now selects those clock/APIC settings for later lab creations as well. PowerShell
parsing and mocked identity/state guard tests passed; the live clock experiment
and a successful fresh-install validation are still pending.

The initial compatibility command hit another VirtualBox session-lock wording
(`locked for a session`, rather than `locked by a session`). A later attempt
created snapshot before-clock-compatibility-20261113T205911Z but startup failed
because CPU APIC was disabled in the saved current VM settings. This was a harness
configuration error. The command now explicitly enables CPU APIC and I/O APIC,
and verifies current CPU XML before startup. Session-lock retries accept both
observed wording variants and continue to recheck identity and power-off state.
The -Resume option requires the matching pending record and verifies that its
existing snapshot is accessible before proceeding, avoiding another snapshot or
shutdown. APIC, lock-retry and identity/state regression checks passed. Successful
boot with the corrected profile remains pending live validation.

## Fresh-install validation completed

The clean-install VM was found in an `aborted` state with CPU APIC disabled
(`apic="off"`), which is what prevented the 64-bit guest from booting. The
known-good MoCI3 reference uses `apic="on"`. After clearing the aborted state,
the CPU/clock profile was set to match the tested router
(`--paravirt-provider none --x86-x2apic off --apic on --ioapic on --x86-pae on`)
and the installed disk was cold-started headless. The guest booted cleanly:
`0.11.1-rc.5`, correct wall clock, advancing uptime. The kernel logs a benign
"TSC doesn't count with P0 frequency" warning and falls back to a working
clocksource; this does not affect the validated clock.

Two defects in the validation tooling were found and fixed while completing this
gate (commit `40fd6c9`):

- Legacy `scp -O` derives the remote basename by splitting on `/`, so Windows
  backslash source paths were stored on the guest under their full path and the
  guest checks could not be found. All local upload paths now use forward
  slashes.
- The clean-install MAC-mapping check read `brif/<port>/address`, which
  bridge-port sysfs does not expose. It now reads the interface's own
  `/sys/class/net/<port>/address`. The regression test models the real layout.

`Test-MoCI-CleanInstall.ps1` then passed all nine checks
(`artifacts/cleaninstall-check-20261113T213959Z-5674c728/cleaninstall-report.json`,
`success: true`): fresh-VM identity, installed version/runtime source, root
expanded and corrected to fill the 64 GiB disk (`resize_inode` absent),
installer LAN/WAN adapter mapping (`br-lan`/`eth1`, recorded MACs), disabled
unconfigured UPS, persistent Docker defaults, default-container DNS and HTTP
egress, and router plus isolated namespace-client connectivity. A fresh private
settings backup was downloaded and checksum-verified. No repairs were applied.

This closes the tested-VM fresh-install gate. `release_ready` remains false:
independent external WAN-client isolation, real firewall allow/deny and
port-forward traffic tests with cleanup, management-loss rollback, durable
app-data migration and physical P09B/J4125 hardware qualification are still
outstanding. The installer ISO remains for fresh installs only, never a
sysupgrade payload.
