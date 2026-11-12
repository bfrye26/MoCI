# MoCI native UPnP + Docker LAN automation + App Store expansion

Status: **draft development release, not production validated**. Branch:
`feature/upnp-docker-lan-store-20261112`, base:
`feature/docker-store-readiness-20261112`.

## Capabilities
1. **Network > UPnP & Port Mapping**: independent UPnP and NAT-PMP/PCP,
   secure mode, trusted client LAN, WAN selection, read-only active mappings,
   one-default-allow-rule port-range editor and double-NAT warning. All
   descriptions are inserted with `textContent` to prevent stored XSS.
2. **Docker LAN firewall**: `/usr/sbin/moci-docker-firewall` is an idempotent
   reconciler, paired with a 45-second procd service. It uses the Docker API
   to select only running containers with `com.moci.managed=true`, verifies
   Compose project labels, requires the actual router LAN IP as the published
   binding and sets rules for each verified private destination IP and TCP port.
   The dedicated firewall4 zone permits **LAN to published TCP ports** and
   **managed Docker to WAN egress**, not inbound WAN and not Docker to LAN.
   No global forwarding, privileged Docker socket mounts or host networking.
3. **Three new reviewed install templates**: Memos (single-container SQLite),
   Beszel Hub (not the privileged agent) and Grafana (first-install password
   generation), all with LAN-bound web ports and named storage. Total reviewed
   template candidates: 8/73. **These new three have not passed runtime tests**.
4. **Firmware** includes `miniupnpd-nftables`, but the UPnP daemon is
   configured disabled until opt-in. `luci-app-upnp` is deliberately not
   bundled while the stored-XSS advisory GHSA-8v49-6387-7f89 is unresolved;
   MoCI displays descriptions using `textContent`.

## Security
- UPnP is explicitly opt-in. NAT-PMP/PCP is distinct from UPnP IGD.
- `secure_mode` is enforced on save, high-port range is 1024–65535,
  guest/IoT interfaces are not automatically trusted.
- UPnP maps WAN ports at client request, while Docker integration is LAN-only.
  They are separate by design.
- UPnP's presentation of client-supplied mapping descriptions is **plain text**;
  never use unescaped HTML (see OpenWrt advisory GHSA-8v49-6387-7f89).
- Existing custom UPnP permission configurations remain intact unless explicitly
  modified. A fully dynamic per-client UPnP rule editor is **not yet implemented**.
- Immutable image approval and administrator confirmation are still required for
  every Docker template. The other 65 catalogue listings remain manual.

## Before enabling firewall automation on the old VirtualBox test VM

The user's working prototype deliberately added two Docker bridges to the old
`firewall.docker.device` list, plus a temporary
`firewall.moci_docker_web_test` rule. These **must not be active in two
different firewall zones simultaneously**. The automatic helper will *refuse*
to change the firewall while an existing zone still owns a managed bridge.

Back up the configuration and, from the VirtualBox console only, remove the
specific temporary test entries **after confirming their current values**:

```sh
cp /etc/config/firewall /root/firewall.before-moci-automatic
uci show firewall.docker.device
uci show firewall.moci_docker_web_test
# The original VM test used:
uci -q del_list firewall.docker.device='br-72415457d0fb'
uci -q del_list firewall.docker.device='br-dead64d1df85'
uci -q delete firewall.moci_docker_web_test
uci commit firewall
fw4 check && /etc/init.d/firewall reload
# Once the updated add-on is installed:
/usr/sbin/moci-docker-firewall plan
/usr/sbin/moci-docker-firewall sync
nft list chain inet fw4 forward
```

If SSH/browser access is lost, use the VM console and restore:

```sh
cp /root/firewall.before-moci-automatic /etc/config/firewall
/etc/init.d/firewall reload
```

Do not remove bridge entries or rules on a production router without confirming
they were created for this test. The reconciler never deletes unrelated UCI
firewall sections.

## Verification checklist
- [ ] `fw4 check` succeeds, LAN web services work, WAN cannot reach them.
- [ ] Recreate IT Tools and OpenSpeedTest networks; firewall rules adjust
      automatically within one poll cycle without stale access.
- [ ] Remove a stack and verify its exact per-container firewall rule disappears.
- [ ] Ensure no Docker bridge is assigned to two fw4 zones.
- [ ] Disable UPnP; verify daemon does not advertise IGD/PCP on LAN.
- [ ] Enable UPnP on a lab WAN; test mapping from trusted LAN only and reject
      guests; verify secure mode prevents mapping to a third-party destination.
- [ ] Map a port using a malicious HTML description and verify the UI escapes it.
- [ ] Verify the VirtualBox WAN double-NAT warning; no upstream reachability
      should be implied.
- [ ] Install Memos, Beszel Hub and Grafana independently, verify readiness,
      credentials, logs, volume persistence, update and clean removal.
- [ ] Build/install a complete OpenWrt 25.12.6 x86-64 EFI image and verify
      package dependencies, procd startup and postinst on actual firmware.

## Next expansion
Create reviewed manifests for each remaining app **only after** identifying
official image tags, health/readiness endpoints, storage, user UID, required
secrets, resource limits, WAN/host device access and migration paths.
Privileged categories (reverse proxies, DNS servers, Docker socket managers,
host monitoring agents) require separate explicit approval workflows.
