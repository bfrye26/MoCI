#!/usr/bin/env bash
# Generate a hybrid Debian live USB installer ISO embedding a verified OpenWrt image.
set -Eeuo pipefail
IMAGE_INPUT=${1:-}
OUTDIR=${2:-}
# Ubuntu 24.04 provides live-build 3.0~a57, which has no GRUB EFI
# --bootloaders option. Build the UEFI ISO with native Debian 12 live-build
# inside an ephemeral Debian chroot, without changing the OpenWrt image.
if [ "${MOCI_DEBIAN_CHROOT:-0}" != 1 ]; then
  case "$( . /etc/os-release; printf '%s' "$ID" )" in
    ubuntu)
      [ "$(id -u)" -eq 0 ] || { echo "ISO builder must run using sudo on Ubuntu." >&2; exit 1; }
      command -v debootstrap >/dev/null || { echo "Install debootstrap with apt." >&2; exit 1; }
      [ -f "$IMAGE_INPUT" ] || { echo "Firmware image not found: $IMAGE_INPUT" >&2; exit 2; }
      INPUT_ABS=$(realpath "$IMAGE_INPUT")
      mkdir -p "$OUTDIR"
      OUTPUT_ABS=$(cd "$OUTDIR" && pwd)
      SRC_ROOT=$(cd "$(dirname "$0")/../.." && pwd)
      BUILD_ROOT=$(mktemp -d /tmp/moci-debian-iso.XXXXXXXX)
      cleanup_chroot() {
        set +e
        for p in mnt/output dev sys proc; do
          mountpoint -q "$BUILD_ROOT/$p" && umount -R "$BUILD_ROOT/$p"
        done
        rm -rf -- "$BUILD_ROOT"
      }
      trap cleanup_chroot EXIT
      echo "[MoCI] Ubuntu live-build is too old for UEFI; bootstrapping Debian 12 build environment."
      debootstrap --arch=amd64 --variant=minbase bookworm "$BUILD_ROOT" https://deb.debian.org/debian
      cp -L /etc/resolv.conf "$BUILD_ROOT/etc/resolv.conf"
      mkdir -p "$BUILD_ROOT"/{proc,sys,dev,mnt/output,mnt/moci-src/firmware/installer}
      mount -t proc proc "$BUILD_ROOT/proc"
      mount --rbind /sys "$BUILD_ROOT/sys"
      mount --make-rslave "$BUILD_ROOT/sys"
      mount --rbind /dev "$BUILD_ROOT/dev"
      mount --make-rslave "$BUILD_ROOT/dev"
      mount --bind "$OUTPUT_ABS" "$BUILD_ROOT/mnt/output"
      cp "$SRC_ROOT/firmware/installer/build-live-iso.sh" "$BUILD_ROOT/mnt/moci-src/firmware/installer/"
      cp "$SRC_ROOT/firmware/installer/moci-install" "$BUILD_ROOT/mnt/moci-src/firmware/installer/"
      mkdir -p "$BUILD_ROOT/mnt/moci-src/files"
      cp "$SRC_ROOT/files/moci-hardware-check" "$BUILD_ROOT/mnt/moci-src/files/"
      cp "$INPUT_ABS" "$BUILD_ROOT/mnt/moci-src/firmware.img.gz"
      chroot "$BUILD_ROOT" /usr/bin/env DEBIAN_FRONTEND=noninteractive \
        /usr/bin/apt-get update
      chroot "$BUILD_ROOT" /usr/bin/env DEBIAN_FRONTEND=noninteractive \
        /usr/bin/apt-get install -y --no-install-recommends \
        live-build debootstrap xorriso squashfs-tools grub-efi-amd64-bin \
        grub-common grub2-common mtools dosfstools ca-certificates wget \
        curl gnupg rsync isolinux syslinux-common
      echo "[MoCI] Starting Debian 12 native live-build with GRUB EFI."
      chroot "$BUILD_ROOT" /usr/bin/env MOCI_DEBIAN_CHROOT=1 \
        /bin/bash /mnt/moci-src/firmware/installer/build-live-iso.sh \
        /mnt/moci-src/firmware.img.gz /mnt/output
      exit 0
      ;;
  esac
fi
[[ -f "$IMAGE_INPUT" ]] || { echo "Usage: build-live-iso.sh firmware.img.gz output-dir" >&2; exit 2; }
command -v lb >/dev/null || { echo "Install Debian live-build first." >&2; exit 1; }
command -v xorriso >/dev/null || { echo "Install xorriso first." >&2; exit 1; }
REPO=$(cd "$(dirname "$0")/../.." && pwd)
mkdir -p "$OUTDIR"
OUTDIR=$(cd "$OUTDIR" && pwd)
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
cd "$WORK"
# The host is Ubuntu, but the live installer must use Debian repositories.
# Explicit mode and mirrors prevent live-build from inheriting the Ubuntu
# archive (archive.ubuntu.com/ubuntu/dists/bookworm does not exist).
# UEFI-only installer: do not invoke the Syslinux/ISOLINUX BIOS bootloader.
# Ubuntu's live-build may fail assembling Syslinux when its files are absent.
# The target router is UEFI, so use GRUB EFI exclusively.
lb config --mode debian --distribution bookworm --architectures amd64 --binary-images iso-hybrid \
  --bootloaders grub-efi \
  --mirror-bootstrap https://deb.debian.org/debian \
  --mirror-chroot https://deb.debian.org/debian \
  --mirror-binary https://deb.debian.org/debian \
  --mirror-chroot-security https://security.debian.org/debian-security \
  --mirror-binary-security https://security.debian.org/debian-security \
  --archive-areas main --bootappend-live "boot=live components quiet" \
  --debian-installer false --security false \
  --firmware-chroot false --firmware-binary false
# Ubuntu live-build's automatic firmware discovery fetches the obsolete
# /dists/bookworm/Contents-amd64.gz and fails with HTTP 404. The ISO is a
# minimal installer, not the router runtime; skip auto firmware discovery.
# Ubuntu 24.04 ships an older live-build that constructs 'bookworm/updates'
# for Debian security, a nonexistent suite (HTTP 404). Prevent that
# automatic source and add Debian 12's valid suite explicitly for both
# package installation and the resulting live system.
mkdir -p config/archives config/package-lists config/includes.chroot/usr/local/sbin \
  config/includes.chroot/opt/moci config/includes.chroot/etc/profile.d
printf '%s\n' 'deb https://security.debian.org/debian-security bookworm-security main' \
  > config/archives/moci-security.list.chroot
cp config/archives/moci-security.list.chroot config/archives/moci-security.list.binary
cat > config/package-lists/moci.list.chroot <<'PKGS'
live-boot
live-config
sudo
whiptail
gdisk
parted
e2fsprogs
openssl
util-linux
udev
dosfstools
ca-certificates
pciutils
usbutils
iw
PKGS
install -m 0755 "$REPO/firmware/installer/moci-install" config/includes.chroot/usr/local/sbin/moci-install
install -m 0755 "$REPO/files/moci-hardware-check" config/includes.chroot/usr/local/sbin/moci-hardware-check
cp "$IMAGE_INPUT" config/includes.chroot/opt/moci/firmware.img.gz
(cd config/includes.chroot/opt/moci && sha256sum firmware.img.gz > firmware.sha256)
cat > config/includes.chroot/etc/profile.d/99-moci-installer.sh <<'AUTOSTART'
# Launch only on the first local interactive console login.
if [ "$(tty 2>/dev/null)" = "/dev/tty1" ] && [ -z "$MOCI_INSTALLER_SHOWN" ]; then
  export MOCI_INSTALLER_SHOWN=1
  if command -v sudo >/dev/null; then
    sudo -n /usr/local/sbin/moci-install || true
  fi
fi
AUTOSTART
chmod 644 config/includes.chroot/etc/profile.d/99-moci-installer.sh
lb build
iso=$(find . -maxdepth 1 -type f -name '*.iso' -print -quit)
[ -n "$iso" ] || { echo "live-build did not produce an ISO" >&2; exit 1; }
cp "$iso" "$OUTDIR/MoCI-x86-64-UEFI-Installer-UNTESTED.iso"
(cd "$OUTDIR" && sha256sum MoCI-x86-64-UEFI-Installer-UNTESTED.iso > SHA256SUMS)
