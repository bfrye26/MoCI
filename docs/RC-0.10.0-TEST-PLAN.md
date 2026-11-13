# MoCI 0.10.0 RC testing guide

**Status:** RC development / Hyper-V acceptance testing, **not** a production router release.

## Proven on the user's Hyper-V test system (Nov. 11, 2026)

- OpenWrt 25.12.6 x86-64 UEFI firmware compiles, installs from the custom Debian ISO, and boots.
- LAN `br-lan` is reachable at `192.168.50.1` after swapping the initial Hyper-V adapter mapping.
- Docker Engine 27.3.1 is operational.
- Missing `python3-email` and `python3-urllib` dependencies were identified and fixed in source. Previously built images need these installed manually or a firmware rebuild.
- The Applications catalogue returns 73 entries and the RPC methods are discoverable.
- Six theme palettes and an appearance selector are committed but still require device/browser testing.

## Release-candidate change scope

1. Docker add-on version 0.10.0, with package dependencies including the Python modules required by the RPC adapter.
2. Read-only Docker inventory remains available by default.
3. Explicitly authorized deployments and managed container lifecycle methods have been implemented in the backend. Write operations remain **OFF by default**.
4. `container_action` is restricted to `start`, `stop`, or `restart` for containers carrying `com.moci.managed=true`. Arbitrary container IDs cannot bypass the label check.
5. `deploy` accepts only JSON containing `services`, an approved digest-pinned image, limited named volumes, and loopback-only TCP ports. It rejects host networking, privilege escalation, host bind mounts and unreviewed images.
6. App Store install readiness requires an explicitly approved image and a reviewed, low-risk, easy-setup template. **The shipped policy contains no approved images**, so no App Store cards are enabled out of the box.
7. Six UI themes: Obsidian Dark, Cloud Light, Ocean Blue, Terminal Green, Amethyst and Graphite Copper. The selected theme persists in browser localStorage, *not* credentials.
8. Regression tests exercise deny-by-default, write authorization gating, Docker method allowlisting and managed-only controls.

## Local RC build and VM test

On Windows use MoCI Local Builder v1.6 with a *clean* Git checkout. Preserve local modifications before updating. The previous `-UpdateSource` safety check aborts on uncommitted changes.

1. Update the repository branch `develop/docker-manager` and build firmware using the existing WSL2 workflow.
2. Build the ISO with the Debian 12 chroot installer builder.
3. Create a disposable Hyper-V Generation 2 VM, with Secure Boot disabled and a new virtual SSD.
4. Attach a private WAN switch and an internal LAN switch. Check the **MAC-to-interface** mapping, not Hyper-V adapter ordering.
5. Install from ISO and boot without the ISO. Verify `ip -br addr`, `docker info`, `/usr/libexec/rpcd/moci-docker list`, and `ubus -v list moci-docker`.
6. Verify `http://192.168.50.1/moci/`, theme switching, refresh persistence, MoCI navigation, and Applications catalogue.
7. Verify unauthorized Docker operations fail. Do not test destructive operations on production networking or physical storage.
8. Verify `docker` inventory, logs, network, volume and image views under both dark and light themes.

## Development-only write-mode policy

**Do not set write mode on a production router.** Current GUI sessions and Docker socket permissions have not passed an independent non-root privilege isolation assessment. The operator must explicitly opt in on an isolated test VM:

```sh
# Test VM ONLY, as root, after reviewing and understanding the trust boundary.
printf 'enabled\n' > /etc/moci-docker/enable-deployments
chmod 600 /etc/moci-docker/enable-deployments
/etc/init.d/rpcd restart
```

To turn write operations off again:

```sh
rm -f /etc/moci-docker/enable-deployments
/etc/init.d/rpcd restart
```

The shipped `allowed-images.json` has an empty `images` list and `app-pins.json` is empty. No registry digest is fabricated in the firmware.

The new root-only policy helper is installed at `/usr/sbin/moci-docker-policy` in freshly rebuilt firmware. Use the following **only on an isolated test VM**:

```sh
moci-docker-policy status
# Research and verify the actual digest from its trusted image publisher.
docker pull example/reviewed@sha256:REPLACE_WITH_REAL_64_HEX_DIGEST
moci-docker-policy allow example/reviewed@sha256:REPLACE_WITH_REAL_64_HEX_DIGEST
# 'pin' works only for catalogue entries with reviewed easy/low-risk templates.
moci-docker-policy pin APP_ID example/reviewed@sha256:REPLACE_WITH_REAL_64_HEX_DIGEST
moci-docker-policy enable
# Test approved deployments and managed containers in MoCI Applications.
moci-docker-policy disable
```

The `REPLACE_WITH_REAL_64_HEX_DIGEST` text is deliberately a placeholder, not an actual digest. The image reference must use a real 64-character sha256 digest obtained and verified by the administrator. For a custom Compose stack, allow the image and enter a digest-pinned JSON spec via the managed stack editor; this currently binds service ports to loopback only.

The `deploy` RPC expects a validated JSON service spec. The current implementation restricts published ports to loopback, so network-accessible application setup needs more dedicated policy work. Existing stack controls also remain gated.

## Exit criteria before public RC / production

- [ ] CI and local package build, firmware build, and Debian ISO assembly all pass using the **same commit**.
- [ ] All six themes pass desktop and narrow-view tests, including the Docker add-on.
- [ ] Clean install and unattended reboot work, without missing Python libraries.
- [ ] Actual template-by-template application installation, persistence, restart, upgrades and removal tested with pinned digests.
- [ ] Validate the on-device policy helper and negative permission tests on a clean x86-64 image.
- [ ] Device-specific disk selection, boot media protection, filesystem expansion and recovery verified.
- [ ] Docker authorization reviewed; reject non-root privilege escalation and unauthorized RPC requests.
- [ ] WAN firewall exposure, DHCP, DNS, storage, and backup tests pass on physical test hardware.
- [ ] Final release artifacts and checksums published with explicit known limitations.

This is an **RC validation baseline**, not a claim that all 73 applications are functional one-click installs or that Docker write access is production secure.

## Expanded branch status: advanced OpenWrt, StartWRT concepts and app preparation

Changes made after the initial baseline, pending a **fresh firmware rebuild and VM verification**:

- Native Advanced OpenWrt UCI forms for business-oriented packages, with explicit confirmation and timed rollback for connectivity-critical changes. This provides UCI section management but **is not full parity with every LuCI app's specialized screens**.
- StartWRT-inspired contextual Help Mode and isolated Security Profiles. The profile wizard attaches firewall isolation to a pre-existing logical network interface, permits DNS/DHCP to the router, and optionally allows WAN forwarding. It does not configure physical VLAN switch ports or Wi-Fi credential-to-VLAN mapping automatically.
- Docker policy helper now has `prepare <app-id>` to fetch only root-owned reviewed image tags, inspect their immutable registry digests and record approved pins.
- GUI can **Prepare & install** approved pilot apps after the root administrator enables deployments. Four pilot configurations exist in source: Uptime Kuma 2, IT Tools, OpenSpeedTest and CyberChef. Each needs on-device deployment and persistence verification before being called production-ready.
- Approved stateful application profiles may use writable container root filesystems only if image, published LAN ports and volumes precisely match the trusted template. Arbitrary Compose retains read-only, unprivileged defaults.
- Dashboard graph now derives stroke colours from the active theme and shows a sample-collection indicator; Cloud Light styling has been reworked.

### Remaining mandatory release gates

- [ ] Build a fresh OpenWrt x86-64 EFI image and Debian ISO containing all changes and pass full firmware/package compilation.
- [ ] Validate `docker compose version` and test pilot app pull, create, health, LAN access, persistence through reboot, stop/start, and uninstall without leaving stale data.
- [ ] Verify Docker's LAN-only published ports cannot be reached from WAN and that firewall reloads do not expose container ports.
- [ ] Confirm network profile wizard rollback in Hyper-V and with physical Ethernet/VLAN-capable hardware.
- [ ] Complete StartWRT-style per-Ethernet-port policies, multi-password Wi-Fi dynamic VLAN, inbound/outbound WireGuard policy, chaining and Wi-Fi schedules with hardware-aware tests.
- [ ] Complete native MoCI support for specialized LuCI service settings, including multi-WAN, PBR, banIP, monitoring, certificate renewal and backup/restore.
- [ ] Test all six themes in desktop/mobile browsers including console logs and errors.
- [ ] Independent security evaluation of privileged Docker RPC, session/ACL boundaries and CSRF.
- [ ] Verify physical x86-64 installer on a disposable SSD and recovery from interrupted writes.
- [ ] Publish candidate firmware/ISO only after checksums, test reports and release provenance are available.

**Source CI passing is not evidence that the above runtime acceptance checks have passed.**

