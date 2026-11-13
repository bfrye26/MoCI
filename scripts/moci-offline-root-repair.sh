#!/bin/bash
# Disposable-VM repair only. Run from the Debian live recovery ISO, never OpenWrt.
set -Eeuo pipefail
fail() { printf 'STOP: %s\n' "$*" >&2; exit 1; }
[[ $(id -u) == 0 ]] || fail 'Run with sudo.'
[[ -d /run/live/medium ]] || fail 'Boot the Debian live recovery ISO first.'
identity=$(tr '[:upper:]' '[:lower:]' </sys/class/dmi/id/product_uuid)
case "$identity" in
  97b3d07b-5b50-4662-9d1e-86f3fa22a857|7bd0b397-505b-6246-9d1e-86f3fa22a857) ;;
  *) fail 'Hardware UUID does not match the disposable MoCI test VM.';;
esac
root=/dev/sda2
[[ -b "$root" ]] || fail 'Expected root partition is missing.'
[[ $(cat /sys/class/block/sda2/start) == 33280 ]] || fail 'Unexpected root partition start.'
[[ $(blkid -s TYPE -o value "$root") == ext4 ]] || fail 'Root is not ext4.'
[[ $(blkid -s UUID -o value "$root") == ff313567-e9f1-5a5d-9895-3ba130b4a864 ]] || fail 'Unexpected root filesystem UUID.'
[[ $(blockdev --getsize64 "$root") == 47068217344 ]] || fail 'Root partition is not the verified expanded VM partition.'
devices=$(lsblk -nr -o MAJ:MIN /dev/sda)
[[ -n "$devices" ]] || fail 'Could not inspect target-disk usage.'
for device in $devices; do
  if findmnt -rn -o MAJ:MIN | grep -Fxq "$device"; then fail 'A target-disk filesystem is mounted. No repair started.'; fi
done
grep -qE '^/dev/sda' /proc/swaps && fail 'Target disk is in use as swap.'
for tool in e2fsck tune2fs resize2fs dumpe2fs; do command -v "$tool" >/dev/null || fail "Missing tool: $tool"; done
work=$(mktemp -d /tmp/moci-offline-root.XXXXXXXX)
mounted=0
cleanup() { if (( mounted )); then umount "$work"; fi; }
trap cleanup EXIT
# noload prevents journal replay during the read-only identity check.
mount -t ext4 -o ro,noload "$root" "$work"; mounted=1
grep -qx 'MOCI_VERSION=0.11.1-rc.4' "$work/etc/moci-release" || fail 'Unexpected installed firmware version.'
umount "$work";mounted=0
log=/tmp/moci-offline-root-repair.log
exec > >(tee "$log") 2>&1
echo 'Verified disposable VM, filesystem identity, capacity and unmounted state.'
echo 'The VM snapshot is the recovery point. No partition layout changes are made here.'
status=0
e2fsck -f -p "$root" || status=$?
(( status <= 1 )) || fail "Initial filesystem check needs review (exit $status); stopped before feature changes."
tune2fs -O ^resize_inode "$root"
status=0
e2fsck -f -y "$root" || status=$?
(( status <= 1 )) || fail "Offline metadata repair failed (exit $status)."
e2fsck -f -n "$root"
resize2fs "$root"
e2fsck -f -n "$root"
header=$(dumpe2fs -h "$root" 2>/dev/null)
blocks=$(awk '$1=="Block" && $2=="count:" {print $3}' <<<"$header")
blocksize=$(awk '$1=="Block" && $2=="size:" {print $3}' <<<"$header")
[[ "$blocks" =~ ^[0-9]+$ && "$blocksize" =~ ^[0-9]+$ ]] || fail 'Could not verify filesystem capacity.'
(( blocks*blocksize >= 47068217344*95/100 )) || fail 'Filesystem capacity remains too small.'
sync
printf 'PASS: offline root repair and growth. Filesystem bytes: %s\n' "$((blocks*blocksize))"
echo 'Leave the VM powered off after: sudo poweroff'
echo 'Then use Complete-MoCI-Storage-Recovery.ps1 in Windows to eject this ISO and boot the router.'
echo "Log in this live session: $log"
