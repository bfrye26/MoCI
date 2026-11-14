# Haven 1.0.0-rc.1 — Release Notes

**Status: lab-validated installable release candidate.** This build is validated in
a VM (clean install, feature and regression checks). It is **not** physical-
hardware-qualified: board-level tests (P09B/J4125), real firewall/throughput
traffic tests, and external WAN-client isolation still require physical hardware.
`release_ready` remains `false` for production use. Treat this as a candidate for
lab/VM and guided bring-up, not a production-hardened firmware.

Built from MoCI commit `6e55e2c6af1b26e35f6422aedc74f6bcb9bb5526` on OpenWrt
**v25.12.6** (`64900e756efa`).

**Firmware image SHA-256:**
`a4f75fe488fb1b8da1ba4b03042ff9ffe212353ddabbc310dbbaca7a16a20be8`
(`openwrt-x86-64-generic-ext4-combined-efi.img.gz`)

Validated on a lab VM: clean boot into 1.0.0-rc.1, RFC 2136 DNS publishing
end-to-end (opt-in → UPDATE → dnsmasq), signature verify-before-install
(valid/tampered/unsigned), and all new UI pages render.

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

> This release ships the **signed firmware image**. The guided UEFI installer ISO
> is a follow-up (it needs a privileged build); the image below is installable now.

**Fresh install:** write the firmware image to the target disk (≥16 GiB, UEFI), e.g.
`gunzip -c openwrt-x86-64-generic-ext4-combined-efi.img.gz | dd of=/dev/sdX bs=4M conv=fsync`,
then boot. (The guided ISO installer, when available, is **fresh-install only** —
never a sysupgrade payload — and requires two wired NICs.)

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
- The installer ISO is UEFI-only and fresh-install only.