#!/usr/bin/env bash
set -euo pipefail
# WSL2 imports Windows PATH entries by default. OpenWrt's Go package
# exports PATH in generated shell commands, where Windows directories with
# spaces or parentheses can break compilation (notably dockerd).
# Do not forward the Windows PATH into the OpenWrt build.
export PATH='/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'
: "${OPENWRT_SRC:?Set OPENWRT_SRC to OpenWrt source}"
: "${MOCI_SRC:?Set MOCI_SRC to MoCI checkout}"
: "${SOURCE_V07:?Set SOURCE_V07 to integrated Docker add-on source}"
WORK=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$OPENWRT_SRC"
for tool in e2fsck tune2fs; do command -v "$tool" >/dev/null || { echo "Missing host tool: $tool" >&2; exit 1; }; done
[[ -f include/toplevel.mk ]] || { echo 'Invalid OpenWrt checkout' >&2; exit 1; }
[[ -f "$MOCI_SRC/Makefile" && -f "$MOCI_SRC/dist/moci/index.html" ]] || { echo 'MoCI dist not built' >&2; exit 1; }
[[ -f "$SOURCE_V07/moci-app-docker/Makefile" ]] || { echo 'Docker add-on source not imported' >&2; exit 1; }
mkdir -p package/moci package/moci-app-docker
# Copy only MoCI's buildable package sources. Do not recursively embed
# firmware scripts, Docker integrations, Git metadata or development assets.
cp "$MOCI_SRC/Makefile" "$MOCI_SRC/LICENSE" "$MOCI_SRC/rpcd-acl.json" package/moci/
cp -a "$MOCI_SRC/files" "$MOCI_SRC/dist" package/moci/
cp -a "$SOURCE_V07/moci-app-docker"/. package/moci-app-docker/
mkdir -p files
cp -a "$WORK/files"/. files/
chmod 0755 files/etc/uci-defaults/90-moci-setup files/etc/uci-defaults/91-moci-secure-admin
chmod 0755 files/etc/uci-defaults/93-moci-runtime-defaults files/usr/libexec/moci-runtime-defaults
chmod 0755 files/etc/uci-defaults/94-moci-grow-root files/usr/libexec/moci-grow-root
chmod 0755 files/etc/uci-defaults/95-moci-dns-publish
./scripts/feeds update -a
./scripts/feeds install -a
cat > .config <<'CONFIG'
CONFIG_TARGET_x86=y
CONFIG_TARGET_x86_64=y
CONFIG_TARGET_x86_64_DEVICE_generic=y
CONFIG_EFI_IMAGES=y
CONFIG_TARGET_ROOTFS_EXT4FS=y
CONFIG_TARGET_ROOTFS_PARTSIZE=8192
CONFIG_PACKAGE_luci=y
# Secure web management and full hostapd for PPSK/dynamic VLAN.
CONFIG_PACKAGE_luci-ssl=y
CONFIG_PACKAGE_openssl-util=y
CONFIG_PACKAGE_luci-app-uhttpd=y
CONFIG_PACKAGE_wpad-basic-mbedtls=n
CONFIG_PACKAGE_wpad-mbedtls=y
CONFIG_PACKAGE_moci=y
CONFIG_PACKAGE_moci-app-docker=y
CONFIG_PACKAGE_dockerd=y
CONFIG_PACKAGE_docker=y
CONFIG_PACKAGE_docker-compose=y
CONFIG_PACKAGE_python3=y
CONFIG_PACKAGE_samba4-server=y
CONFIG_PACKAGE_block-mount=y
CONFIG_PACKAGE_e2fsprogs=y
CONFIG_PACKAGE_resize2fs=y
CONFIG_PACKAGE_sfdisk=y
CONFIG_PACKAGE_partx-utils=y
CONFIG_PACKAGE_parted=y
CONFIG_PACKAGE_lsblk=y
CONFIG_PACKAGE_kmod-fs-ext4=y
CONFIG_PACKAGE_kmod-usb-storage=y
CONFIG_PACKAGE_ca-bundle=y
CONFIG_PACKAGE_curl=y
CONFIG_PACKAGE_iperf3=y
CONFIG_PACKAGE_tcpdump=y
CONFIG_PACKAGE_htop=y
CONFIG_PACKAGE_nano=y
CONFIG_PACKAGE_openssh-sftp-server=y
CONFIG_PACKAGE_kmod-igc=y
CONFIG_PACKAGE_intel-microcode=y
CONFIG_PACKAGE_kmod-hwmon-coretemp=y
CONFIG_PACKAGE_pciutils=y
CONFIG_PACKAGE_usbutils=y
CONFIG_PACKAGE_iw=y
CONFIG_PACKAGE_kmod-tun=y
CONFIG_PACKAGE_wireguard-tools=y
CONFIG_PACKAGE_luci-proto-wireguard=y
CONFIG_PACKAGE_luci-app-sqm=y
CONFIG_PACKAGE_luci-app-ddns=y
# UPnP IGD and NAT-PMP/PCP installed but disabled; use MoCI's escaped native UI.
# Do NOT preinstall luci-app-upnp while GHSA-8v49-6387-7f89 remains unresolved.
CONFIG_PACKAGE_miniupnpd-nftables=y
CONFIG_PACKAGE_luci-app-samba4=y
# Business-ready diagnostics and resilience, available but not auto-enabled.
CONFIG_PACKAGE_luci-app-statistics=y
CONFIG_PACKAGE_luci-app-nlbwmon=y
CONFIG_PACKAGE_luci-app-mwan3=y
CONFIG_PACKAGE_luci-app-banip=y
CONFIG_PACKAGE_luci-app-acme=y
CONFIG_PACKAGE_luci-app-attendedsysupgrade=y
CONFIG_PACKAGE_luci-app-lldpd=y
CONFIG_PACKAGE_luci-app-nut=y
CONFIG_PACKAGE_luci-app-pbr=y
CONFIG_PACKAGE_luci-app-snmpd=y
# Business diagnostics and operational safeguards (not enabled by default).
CONFIG_PACKAGE_luci-app-watchcat=y
CONFIG_PACKAGE_luci-app-vnstat2=y
CONFIG_PACKAGE_luci-app-smartdns=y
CONFIG_PACKAGE_ethtool=y
CONFIG_PACKAGE_irqbalance=y
CONFIG_PACKAGE_uhttpd-mod-ubus=y
CONFIG_PACKAGE_dnsmasq-full=y
CONFIG_PACKAGE_dnsmasq=n
CONFIG
make defconfig
for p in moci moci-app-docker docker-compose dockerd samba4-server uhttpd-mod-ubus luci-ssl wpad-mbedtls luci-app-statistics luci-app-nlbwmon luci-app-mwan3 luci-app-banip luci-app-acme miniupnpd-nftables kmod-igc intel-microcode kmod-hwmon-coretemp pciutils usbutils iw resize2fs sfdisk partx-utils; do
  grep -q "^CONFIG_PACKAGE_${p}=y$" .config || { echo "Missing package after defconfig: $p" >&2; exit 1; }
done
make download -j"${JOBS:-2}"
make -j"${JOBS:-2}" V=s
for image in bin/targets/x86/64/*ext4-combined-efi.img.gz; do
  python3 "$WORK/scripts/normalize-ext4-image.py" "$image"
done
# Sign the release artifacts with usign. The public key ships inside the image
# (/etc/moci/moci-image.pub); the secret key stays on the build host only.
USIGN="$(command -v usign || true)"
if [ -z "$USIGN" ] && [ -x "$PWD/staging_dir/host/bin/usign" ]; then
  USIGN="$PWD/staging_dir/host/bin/usign"
fi
IMAGE_KEY="${MOCI_IMAGE_KEY:-$HOME/.usign/moci-image.sec}"
if [ -n "$USIGN" ] && [ -f "$IMAGE_KEY" ]; then
  ( cd bin/targets/x86/64 && "$USIGN" -S -m sha256sums -s "$IMAGE_KEY" -x sha256sums.sig )
  for image in bin/targets/x86/64/*ext4-combined-efi.img.gz; do
    "$USIGN" -S -m "$image" -s "$IMAGE_KEY" -x "$image.sig"
  done
  echo "Firmware artifacts signed with $IMAGE_KEY"
else
  echo "WARNING: firmware artifacts NOT signed (usign or $IMAGE_KEY missing)" >&2
fi
find bin/targets/x86/64 -maxdepth 1 -name '*ext4-combined-efi.img.gz' -print
