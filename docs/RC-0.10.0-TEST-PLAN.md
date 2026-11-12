# MoCI 0.10.0 RC testing guide

**Status:** RC development / Hyper-V acceptance testing, **not** a production router release.

## Proven on the user's Hyper-V test system (Nov. 11, 2026)

- OpenWrt 25.12.2 x86-64 UEFI firmware compiles, installs from the custom Debian ISO, and boots.
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

The shipped `allowed-images.json` has an empty `images` list and `app-pins.json` is empty. Digest policies must be maintained locally by a trusted administrator with verified image digests, and the Docker engine must be able to pull those images. No registry digest is fabricated in the firmware.

The `deploy` RPC expects a validated JSON service spec. The current implementation restricts published ports to loopback, so network-accessible application setup needs more dedicated policy work. Existing stack controls also remain gated.

## Exit criteria before public RC / production

- [ ] CI and local package build, firmware build, and Debian ISO assembly all pass using the **same commit**.
- [ ] All six themes pass desktop and narrow-view tests, including the Docker add-on.
- [ ] Clean install and unattended reboot work, without missing Python libraries.
- [ ] Actual template-by-template application installation, persistence, restart, upgrades and removal tested with pinned digests.
- [ ] Device-specific disk selection, boot media protection, filesystem expansion and recovery verified.
- [ ] Docker authorization reviewed; reject non-root privilege escalation and unauthorized RPC requests.
- [ ] WAN firewall exposure, DHCP, DNS, storage, and backup tests pass on physical test hardware.
- [ ] Final release artifacts and checksums published with explicit known limitations.

This is an **RC validation baseline**, not a claim that all 73 applications are functional one-click installs or that Docker write access is production secure.
