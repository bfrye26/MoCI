# Haven 1.0.0-rc.2 — Release Notes

**Status: validated on physical hardware (P09B / J4125) and lab VM.** This build was
sysupgraded onto a real 6-port I225-V P09B router and every add-on, toggle and the
device-vendor lookup were verified working there. `release_ready` remains `false`
for production use until broader hardware/traffic qualification is complete.

Built from MoCI commit `827d4c31` on OpenWrt **v25.12.6**.

**Firmware image SHA-256:**
`2d6f122a7fcbe43a8d4ee2d2ad89443669efe736da72c3fc521bdf2b657cccb6`
(`openwrt-x86-64-generic-ext4-combined-efi.img.gz`)

**Installer ISO SHA-256 (dual-boot BIOS + UEFI):**
`3306d6b10e1c14bff8dd06f5df20b0512e005b7c4fab28dce330610791b63b88`
(`MoCI-x86-64-Installer.iso`)

## What's new in 1.0.0-rc.2

### Native add-on dashboards, each with an on/off toggle
A new **Features** page (System → Features) is the control center. Every native
add-on has its own switch that (1) shows/hides its dashboard, (2) enables/disables
the service at boot, and (3) starts/stops it now. **All new add-ons ship OFF** — a
first-boot script stops and disables their services until you turn them on.

- **Network Performance**
  - **SQM / Bufferbloat** — Smart Queue Management (cake / fq_codel) with a live
    service-status badge on Traffic & QoS.
  - **Bandwidth Monitor** — per-device top talkers, totals and protocol breakdown
    from nlbwmon.
  - **Multi-WAN / Failover** — live WAN interface status, policies and rules (mwan3).
- **Security & Privacy**
  - **Ad Blocking** — network-wide DNS ad/malware blocking (adblock) with status,
    blocked-domain counts and source overview.
  - **Tailscale VPN** — zero-config mesh VPN: connect/login, node + peer status.
  - (WireGuard already has VPN & Failover; AdGuard Home / Pi-hole remain one-click
    Docker apps with native integrations.)
- **System & Diagnostics**
  - **Web Terminal** — browser terminal (ttyd) with htop; LAN-only, root-shell warning.
  - **Statistics / Graphs** — CPU, memory, load and network graphs from collectd RRDs.
  - **NAS / File Sharing** — detected drives + Samba share management (block-mount).
  - **Attended upgrade** — a native "Check for updates" against the latest release.

### Real device vendors
The Devices page now resolves vendors from the **full IEEE MA-L OUI registry**
(~40,000 prefixes, lazy-loaded) instead of a small hand-picked table. It also
detects **private/randomized MACs** and recognises common virtualization prefixes,
so devices show real makers (Apple, Samsung, Google, Synology, Sonos, …) rather
than "Unknown vendor".

### Fixes / hardening carried forward from rc.1
All Ethernet ports activated on multi-port x86, dual-boot installer ISO, Wi-Fi
drivers + stack, ARP-based device listing, isolated-network WAN access, signed
opt-in updates, and the full StartWRT feature parity set.

## Installing

This release ships both the **signed firmware image** and the **guided dual-boot
installer ISO** (`MoCI-x86-64-Installer.iso`, boots on BIOS/CSM and UEFI).

**Fresh install (recommended):** write the installer ISO to a USB stick (e.g.
`dd if=MoCI-x86-64-Installer.iso of=/dev/sdX bs=4M conv=fsync` or Rufus/balenaEtcher),
boot the target, and follow the guided installer. The ISO is **fresh-install only** —
it is never a sysupgrade payload. Requires a ≥16 GiB disk and two wired NICs.

**Upgrade an existing Haven router:** upload the firmware image (`.img.gz`) and its
`.sig` signature on System → Firmware Upgrade. Haven verifies the signature, then
`sysupgrade --test`, then flashes after confirmation. Configuration (network,
Wi-Fi, firewall) is preserved.

> **Upgrade data-loss constraint:** full-image x86 sysupgrade does **not** preserve
> root-resident Docker app data. Back up app data first, or upgrade empty-app systems.

## Verifying the artifacts

Each artifact ships with a SHA-256 checksum (`SHA256SUMS`) and a detached usign
signature (`.sig`). The public key is baked into the firmware at
`/etc/moci/moci-image.pub` and committed in the repo as `files/moci-image.pub`.

```sh
sha256sum -c SHA256SUMS
usign -V -p moci-image.pub -m openwrt-x86-64-generic-ext4-combined-efi.img.gz \
      -x openwrt-x86-64-generic-ext4-combined-efi.img.gz.sig
usign -V -p moci-image.pub -m MoCI-x86-64-Installer.iso \
      -x MoCI-x86-64-Installer.iso.sig
```

## Security posture (preserved)
- firewall4/nftables stays; no automatic WAN publishing; UPnP, delegated ports and
  DNS publishing are opt-in/off by default.
- New add-ons are **off by default**; the web terminal is LAN-only and clearly warned.
- No Docker socket exposure or unrestricted LAN forwarding; sensitive-data apps
  require explicit approval; secrets are never exposed to the browser.

## Known limitations
- Not production-qualified (see status above).
- The web terminal is plain HTTP; when the UI is served over HTTPS, use
  "Open in new tab" (the embedded frame is blocked as mixed content).
- Tailscale requires an interactive login (the dashboard shows the auth link).
- VPN chaining supports static IPv4 endpoints only.