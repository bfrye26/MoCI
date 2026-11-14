# Haven 1.0.0-rc.1 — Release Notes

**Status: lab-validated installable release candidate.** This build is validated in
a VM (clean install, feature and regression checks). It is **not** physical-
hardware-qualified: board-level tests (P09B/J4125), real firewall/throughput
traffic tests, and external WAN-client isolation still require physical hardware.
`release_ready` remains `false` for production use. Treat this as a candidate for
lab/VM and guided bring-up, not a production-hardened firmware.

Built from MoCI commit `aacdda3` on OpenWrt **v25.12.6** (`64900e756efa`).

**Firmware image SHA-256:**
`565e4aa0ffd729a29e067cf204e3044e373f8fc7fa9d5912f1d3a4be214b4483`
(`openwrt-x86-64-generic-ext4-combined-efi.img.gz`)

**Installer ISO SHA-256 (dual-boot BIOS + UEFI):**
`d980b473319b2991576bd57edd5c4cc5f41fbeeeab2426461c2228f3d1e4824d`
(`MoCI-x86-64-Installer.iso`)

Validated on a lab VM: clean boot into 1.0.0-rc.1, RFC 2136 DNS publishing
end-to-end (opt-in → UPDATE → dnsmasq), signature verify-before-install
(valid/tampered/unsigned), and all new UI pages render. App integrations refresh
in the sidebar automatically when apps are installed/started/stopped/removed.

### Fixes since the first rc.1 build
- **All UI pages now ship in the image.** The package Makefile previously
  installed a stale module list, so WAN, Devices, QoS, Published Ports,
  Wi-Fi, Guest/IoT Networks, HTTPS and the app integrations were missing from the
  firmware and loaded as blank pages on a fresh install. The image now installs
  every built module and the self-hosted font (verified: 19 modules present).
- **Installer ISO is now dual-boot (BIOS + UEFI).** The earlier UEFI-only ISO
  dropped to `grub rescue> … i386-pc/normal.mod not found` on hardware booting in
  BIOS/CSM mode. The ISO now carries a Syslinux BIOS bootloader alongside GRUB
  EFI (verified: `isolinux.bin` + isohybrid MBR + EFI boot image).
- **All Ethernet ports are activated on multi-port x86 routers.** First-boot now
  brings up every physical port and bridges all non-WAN ports into the LAN
  (previously only one WAN + one LAN port were configured, leaving the rest
  DOWN). Verified on a 6-port I225-V (P09B) device.
- **Ethernet port profiles can reclaim LAN ports.** The wizard previously
  reserved every bridge member, so no port was selectable once all ports were
  bridged. Now only the WAN uplink and the last management LAN port are reserved;
  other LAN ports can be assigned to an isolated profile (removed from the bridge,
  rollback-safe).
- **Wi-Fi drivers + stack are now included.** The image ships the mac80211/cfg80211
  stack, `rt2800-usb` (the Ralink RT3070 `13d3:3273` found in the P09B), plus
  mt76 / rtl8xxxu / ath9k-htc USB Wi-Fi drivers and firmware, iwinfo and
  wireless-regdb. The RT3070 is detected (phy0) on the test hardware.
- **Devices page shows every LAN device.** It previously counted only DHCP leases
  issued by this router, under-counting on networks where another DHCP server
  (e.g. a mesh system) serves most clients. It now lists every device seen on the
  LAN (ARP), matching the dashboard, enriched with lease/reservation hostnames.
- **Isolated networks can reach the internet.** Port profiles with “Allow internet
  access via WAN” correctly forward to the WAN with NAT (verified: `accept_to_wan`
  + wan masquerade), so an isolated segment still has internet while staying
  separated from the main LAN.

## What's new in 1.0.0-rc.1

Full StartWRT feature parity on Haven's fast x86-64 base, plus the Docker app
store and native app integrations.

### StartWRT parity
- **Navigation & UX** — concept-grouped sidebar (Internet / Network / Security
  Profiles / Points of entry / Apps / System) with collapsible groups, a Ctrl+K
  command palette, six themes, and a persistent contextual Help panel with a
  per-field guide.
- **Unified security profiles** — Admin / Children / Guest / Smart-Devices presets
  that pre-fill DNS, curfew, LAN and WAN policy; clear WAN-access control;
  inbound-VPN-to-profile assignment. Profiles apply with a timed rollback you must
  confirm.
- **Devices** — vendor identity (OUI), per-device profile derivation, and a
  permissions panel (delegate a port, publish a DNS name, manage profile access).
- **Published ports** — per-device delegated self-service port opening (off by
  default) and expiring-lease display. UPnP/NAT-PMP secure mode is enforced.
- **VPN & failover** — live WireGuard tunnel health (handshake/transfer), per-policy
  health badges, and a kill-switch by refusal (no WAN fallback when a tunnel drops).
- **DNS record publishing (RFC 2136)** — a receiver daemon lets opted-in devices
  publish their own A/AAAA names within the local domain. Off by default; router
  and admin names are reserved; records are dropped when a device loses its lease.
- **Signed, opt-in updates** — firmware artifacts are usign-signed; the upgrade UI
  verifies the signature before installing (a bad signature blocks installation;
  an unsigned image needs extra confirmation). Nothing installs automatically.

### Apps
- 33 reviewed one-click Docker templates (AdGuard Home, Pi-hole, Vaultwarden,
  Syncthing, Home Assistant, Plex, Wiki.js, Vikunja, Duplicati, Uptime Kuma, and
  more), digest-pinned, LAN-only firewall, sensitive-data apps gated.
- Native in-UI integrations for Pi-hole, AdGuard Home (stats, protection toggle,
  connect-login, use-as-network-DNS) and Uptime Kuma.

## Installing

This release ships both the **signed firmware image** and the **guided dual-boot
installer ISO** (`MoCI-x86-64-Installer.iso`, boots on both BIOS/CSM and UEFI).

**Fresh install (recommended):** write the installer ISO to a USB stick (e.g.
`dd if=MoCI-x86-64-Installer.iso of=/dev/sdX bs=4M conv=fsync` or Rufus/balenaEtcher),
boot the target, and follow the guided installer. The ISO is **fresh-install only** —
it is never a sysupgrade payload. Requires a ≥16 GiB disk and two wired NICs.

**Direct image write:** alternatively write the firmware image to the target disk,
e.g. `gunzip -c openwrt-x86-64-generic-ext4-combined-efi.img.gz | dd of=/dev/sdX bs=4M conv=fsync`,
then boot.

**Upgrade an existing Haven lab VM:** upload the firmware image (`.img.gz`) and its
`.sig` signature on System → Firmware Upgrade. Haven verifies the signature, then
`sysupgrade --test`, then flashes after confirmation.

> **Upgrade data-loss constraint:** full-image x86 sysupgrade does **not** preserve
> root-resident Docker app data. Only upgrade disposable/empty-app systems, or back
> up app data first.

## Verifying the artifacts

Each artifact ships with a SHA-256 checksum (`SHA256SUMS`) and a detached usign
signature (`.sig`). The public key is baked into the firmware at
`/etc/moci/moci-image.pub` and committed in the repo as `files/moci-image.pub`.

```sh
sha256sum -c SHA256SUMS
usign -V -p moci-image.pub -m openwrt-x86-64-generic-ext4-combined-efi.img.gz \
      -x openwrt-x86-64-generic-ext4-combined-efi.img.gz.sig
```

## Security posture (preserved)
- firewall4/nftables stays; automatic LAN-only Docker firewall; no automatic WAN
  publishing; UPnP, delegated ports and DNS publishing are opt-in/off by default.
- No Docker socket exposure or unrestricted LAN forwarding; sensitive-data apps
  require explicit approval; secrets are never exposed to the browser.

## Known limitations
- Not physical-hardware-qualified (see status above).
- VPN chaining supports static IPv4 endpoints only; dynamic-endpoint chaining and
  strict per-profile DNS-through-tunnel enforcement are documented follow-ups.
- The installer ISO is fresh-install only (it boots on both BIOS/CSM and UEFI).