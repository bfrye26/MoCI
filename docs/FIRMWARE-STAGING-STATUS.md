# MoCI Applications and x86-64 firmware build handoff

**Status: source-integrated development branch. Not production firmware.**
**Branch:** develop/docker-manager
**PR:** https://github.com/bfrye26/MoCI/pull/1

## What is now committed to GitHub

- Native MoCI Applications page with App Store, Docker containers, Compose projects, managed stacks, images, volumes, networks and storage.
- 14-app English-language homelab catalogue. These are discoverable cards, not all functional one-click templates.
- Python rpcd adapter using the Docker Engine Unix socket, without exposing the socket to the browser.
- Restricted Compose schema: digest-pinned images, named volumes, loopback port bindings, non-root container UID, no elevated privileges or shell overrides.
- Negative tests covering rejected mounts, host networking exposure and unapproved image digests.
- OpenWrt x86-64 EFI/ext4 build script and GitHub Actions firmware workflow.
- Existing MoCI saved-password removal and tab-scoped session tokens.

## Security gate, deliberately fail-closed

The Docker backend has WRITES_ENABLED=False. The catalogue reports applications as not ready to install. This is intentional, since upstream MoCI's root-equivalent browser sessions undermine granular rpcd ACL boundaries.

Do **not** change WRITES_ENABLED to True just to enable install buttons. First implement a dedicated non-root rpcd login, remove broad credentials from the web app, and verify both allowed and denied RPC calls on an actual OpenWrt 25.12.2 test device. Then add explicit role/permission checks for all deployment methods.

A source-level ACL declaration alone is not proof of privilege separation. Docker socket access is effectively root-equivalent.

## Firmware build

The GitHub Actions workflow is at .github/workflows/build-x86-uefi.yml.
It pins OpenWrt v25.12.2, creates a generic x86-64 UEFI/ext4 image, and requests:
MoCI, MoCI Docker Manager, LuCI, Docker, Compose, Samba4, WireGuard, SQM, DDNS, TLS certificates and diagnostic tools.

The workflow must show a successful compile and provide *ext4-combined-efi.img.gz* plus SHA256 checksums before any flash testing.

The firmware script uses an 8 GiB ext4 root partition. It does not automatically format or resize a 256 GB SSD. There is no unattended network-interface reassignment and no default router password.

## Required validation before shipping

1. Full GitHub Actions build from the fork. Review the package manifest and resolved dependency set.
2. Boot the image in OVMF/QEMU with at least two emulated NICs; confirm GUI loads from LAN only.
3. Verify default firewall, WAN/LAN mapping, DHCP, DNS, IPv6 and VPN. Do not assume NIC names.
4. Verify Docker Engine and Compose CLI start; inspect CPU, memory, logs, images and storage from MoCI.
5. Test non-root auth with denial of unauthorized file.exec, system.reboot, UCI writes, and Docker deploy.
6. Audit npm package build, Python rpcd runtime dependencies and image-policy file permissions.
7. Add a first-boot network/storage wizard and Samba share management.
8. Test upgrade without losing network config or containers, plus backup and recovery.
9. Verify on spare physical x86 hardware before public production release.

## App Store scope

The catalogue is an extensible curated starting point. Current install actions are disabled until real authorization and image review pass. Advanced manual Compose must stay constrained by server-side validation. Many homelab projects need app-specific persistent mounts, dependencies, secrets, and network access, so per-app templates require testing, not just an image name.

## Useful commands

GitHub fork:
```sh
git clone https://github.com/bfrye26/MoCI.git
cd MoCI
git switch develop/docker-manager
python3 -m unittest discover -s integrations/docker-manager/tests -p 'test*.py' -v
node --check integrations/docker-manager/moci-app-docker/files/addon.js
python3 -m py_compile integrations/docker-manager/moci-app-docker/files/moci-docker-api
```

Build image on an Ubuntu Linux machine with sufficient space:
```sh
npm ci
npm run build
git clone --depth 1 --branch v25.12.2 https://github.com/openwrt/openwrt.git ../openwrt
OPENWRT_SRC="$PWD/../openwrt" MOCI_SRC="$PWD" SOURCE_V07="$PWD/integrations/docker-manager" bash firmware/scripts/build.sh
```

Do not enable Docker write operations, expose MoCI/ubus on WAN, or flash over a live router until all security and connectivity gates pass.

