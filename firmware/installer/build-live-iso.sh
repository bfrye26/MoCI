#!/usr/bin/env bash
# Generate a hybrid Debian live USB installer ISO embedding a verified OpenWrt image.
set -Eeuo pipefail
IMAGE_INPUT=$1
OUTDIR=$2
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
lb config --mode debian --distribution bookworm --architectures amd64 --binary-images iso-hybrid \
  --mirror-bootstrap https://deb.debian.org/debian \
  --mirror-chroot https://deb.debian.org/debian \
  --mirror-binary https://deb.debian.org/debian \
  --mirror-chroot-security https://security.debian.org/debian-security \
  --mirror-binary-security https://security.debian.org/debian-security \
  --archive-areas main --bootappend-live "boot=live components quiet" \
  --debian-installer none --security false
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
PKGS
install -m 0755 "$REPO/firmware/installer/moci-install" config/includes.chroot/usr/local/sbin/moci-install
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
