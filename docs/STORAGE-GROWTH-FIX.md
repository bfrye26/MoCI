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
