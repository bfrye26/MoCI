#!/usr/bin/env bash
set -euo pipefail
: "${OPENWRT_SRC:?Set OPENWRT_SRC to OpenWrt source}"
: "${MOCI_SRC:?Set MOCI_SRC to MoCI checkout}"
: "${SOURCE_V07:?Set SOURCE_V07 to integrated Docker add-on source}"
WORK=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$OPENWRT_SRC"
[[ -f include/toplevel.mk ]] || { echo 'Invalid OpenWrt checkout' >&2; exit 1; }
[[ -f "$MOCI_SRC/Makefile" && -f "$MOCI_SRC/dist/moci/index.html" ]] || { echo 'MoCI dist not built' >&2; exit 1; }
[[ -f "$SOURCE_V07/moci-app-docker/Makefile" ]] || { echo 'Docker add-on source not imported' >&2; exit 1; }
mkdir -p package/moci package/moci-app-docker
cp -a "$MOCI_SRC"/. package/moci/
rm -rf package/moci/.git
cp -a "$SOURCE_V07/moci-app-docker"/. package/moci-app-docker/
mkdir -p files
cp -a "$WORK/files"/. files/
chmod 0755 files/etc/uci-defaults/90-moci-setup
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
CONFIG_PACKAGE_moci=y
CONFIG_PACKAGE_moci-app-docker=y
CONFIG_PACKAGE_dockerd=y
CONFIG_PACKAGE_docker=y
CONFIG_PACKAGE_docker-compose=y
CONFIG_PACKAGE_python3-light=y
CONFIG_PACKAGE_samba4-server=y
CONFIG_PACKAGE_block-mount=y
CONFIG_PACKAGE_e2fsprogs=y
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
CONFIG_PACKAGE_kmod-tun=y
CONFIG_PACKAGE_wireguard-tools=y
CONFIG_PACKAGE_luci-proto-wireguard=y
CONFIG_PACKAGE_luci-app-sqm=y
CONFIG_PACKAGE_luci-app-ddns=y
CONFIG_PACKAGE_luci-app-samba4=y
CONFIG_PACKAGE_dnsmasq-full=y
CONFIG_PACKAGE_dnsmasq=n
CONFIG
make defconfig
for p in moci moci-app-docker docker-compose dockerd samba4-server; do
  grep -q "^CONFIG_PACKAGE_${p}=y$" .config || { echo "Missing package after defconfig: $p" >&2; exit 1; }
done
make download -j"${JOBS:-2}"
make -j"${JOBS:-2}" V=s
find bin/targets/x86/64 -maxdepth 1 -name '*ext4-combined-efi.img.gz' -print
