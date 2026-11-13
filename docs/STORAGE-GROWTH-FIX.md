# Root storage after upgrades

The rc.4 disposable-VM upgrade retained all five core configuration files and
passed router, LAN-client and Docker connectivity checks. Its root filesystem
capacity fell from 46,167,982,080 to 8,302,063,616 bytes. Release remains blocked.

The fresh-install installer expanded ext4, but the firmware did not repeat that
step after x86 sysupgrade replaced the expanded root with the image layout.

The rc.5 source adds `sfdisk`, `partx-utils`, `resize2fs` and first-boot helper
`moci-grow-root`. It accepts only the exact MoCI GPT layout with partitions
1 (boot), 2 (ext4 root) and 128 (BIOS), with their known starts and boot sizes.
Extra partitions, other sector sizes and indirect root devices are refused.
The helper backs up the partition table and disk ends privately, keeps partition
starts and identifiers, expands partition 2 into unused trailing space, updates
the kernel partition size, and then grows ext4 online. It never formats or moves
partitions. `/etc/config/moci_storage`, retained by sysupgrade, allows opt-out
with `moci_storage.root.grow=0`.

`Apply-MoCI-Storage-Growth.ps1` validates both local VM state and remote hardware
identity, requires the original MoCI3 off, takes a recovery snapshot, installs
missing tools through the normal package manager, and applies this helper only
to the disposable VM. A failed report is not a pass; inspect before retrying.

Tests cover layout refusal, capacity calculations and metadata preservation.
Linux CI additionally writes and grows a temporary sparse GPT disk image. Live
root growth and automatic growth after a new-image upgrade still require actual
VM evidence. A manually repaired rc.4 VM cannot prove the rc.5 migration.

This fixes capacity, not application-data migration. Standard x86 full-image
upgrades can replace root filesystem contents. The upgrade runner still refuses
existing Docker containers, volumes and stacks. Durable app storage and external
WAN and hardware tests remain separate release gates.

## First live growth attempt

The 2026-11-13 18:32 disposable-VM attempt reached `resize2fs`, after partition
metadata preservation and the kernel partition-size check. It failed with
`Invalid argument While checking for on-line resizing support`. The report's
`applied: false` meant the whole operation did not complete, not that the
partition table was untouched. Preserve recovery snapshot
`before-storage-growth-20261113T183233Z`. Do not assume filesystem capacity is
unchanged after a failed online resize, since the tool can make partial progress.

Run `Apply-MoCI-Storage-Growth.ps1 -DiagnoseOnly` to read current partition
geometry, the ext4 header and filtered ext4 kernel messages. This mode does not
install packages, retry resizing, run fsck or change filesystem features. Root
capacity and automatic migration remain unverified; the rc.5 source must not be
treated as release validated. Sparse-disk CI validated GPT manipulation only,
not this firmware's mounted ext4 filesystem.

The diagnostic report at 18:35 confirmed a 47,068,217,344-byte partition and
partial filesystem growth to 10,547,974,144 usable bytes. Kernel messages show
`reserve_backup_gdb: reserved block 512 not at offset 511`. A Linux CI reproduction
using the exact pinned OpenWrt make_ext4fs source reproduced online resize failure
even after e2fsck reported a clean image. Removing the legacy `resize_inode`
feature on a private, unmounted image, repairing the resulting metadata offline,
and then growing the mounted image passed CI (run 43485098571). This is an image
metadata compatibility problem, not a reason to run fsck on mounted root.

The build now normalizes the root filesystem in a private temporary regular
file, preserving its UUID and block count, before recompressing the same combined
image. Boot partitions and GPT bytes are copied unchanged; exported hashes are
updated. Whole-image preservation tests and the full rc.5 VM upgrade still need
to pass before release.

For this exact disposable rc.4 VM only, Start-MoCI-Storage-Recovery.ps1 creates a
copy of the checksum-verified installer ISO containing the offline repair helper,
gracefully powers down the guest, takes a powered-off snapshot and boots that ISO.
Choose Quit in the installer, never Install, then run:

```
sudo bash /run/live/medium/moci-offline-repair.sh
```

The helper requires the expected VM hardware UUID, root filesystem UUID, partition
start and already-expanded partition size, and refuses mounted target partitions.
It checks the existing filesystem before removing resize_inode, repairs that
metadata offline, grows ext4 and verifies a clean filesystem and expected capacity.
Only after PASS, power off the live session and run
Complete-MoCI-Storage-Recovery.ps1 to eject recovery media and boot the router.
No automatic repair or firmware installation occurs on ISO boot. This manual
repair does not establish that an unassisted firmware upgrade preserves capacity.

Full Linux CI run 43485537046 passed on source
77ac51bf9c725b89233b441926a4115095e97a96. It checks real mounted online growth and
sentinel contents after offline normalization, plus processing of a gzip combined
GPT image with byte-for-byte preservation of all regions outside root and correct
exported checksums/profile metadata. The local builder now pins that source.
The recovery launcher and offline helper passed PowerShell parsing and Bash syntax
checks respectively; booting the remastered recovery ISO and repairing this VM
remain pending live execution. No full firmware rebuild or hardware qualification
is claimed by these CI tests.

## Live offline recovery result

The disposable VM returned from offline recovery and rc.4 verification passed
all nine checks in artifacts/upgrade-check-20261113T174638Z-6ec1d229/upgrade-post.json.
Usable root capacity is now 46,194,810,880 bytes, compared with the original
46,167,982,080-byte baseline. Installed version/helper identity, five retained core
configuration files, disabled unconfigured UPS, Docker bridge/return policy,
container DNS/HTTP and router/client connectivity passed. release_ready remains
false. This is a manually repaired rc.4 result and must not replace the original
capacity-failure history. Next build the pinned rc.5 source and validate an upgrade
with automatic storage growth and no subsequent repair. External WAN isolation,
app-data migration and physical hardware qualification remain open.
