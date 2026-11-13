# MoCI 0.11.1 RC: P09B hardware installation
Status: source candidate. A new firmware/ISO build and repeat VM validation are required before hardware installation.

## Hardware target
The reported target is a P09B with a Celeron J4125, six Intel I225-V 2.5 GbE ports, DDR4 memory, SATA/mSATA storage and the optional mini-PCIe Wi-Fi module. The exact fitted Wi-Fi chipset is unknown. No 3G/4G configuration is included.

The existing built image includes kmod-igc. OpenWrt defines this driver for Intel I225 Ethernet controllers. OpenWrt's x86-64 kernel configuration also enables SATA AHCI. The new source explicitly requests igc, Intel microcode, CPU temperature monitoring, PCI/USB inventory tools and iw.

References:
- [VENOEN P09B specifications](https://www.venoen.com/Firewall-router-pfsense-P09B-6-i225-Lan-Firewall-Mini-PC-Celeron-J4125-Pfsense-2.5G-Ethernet-SIM-3G/4G.html)
- [OpenWrt 25.12.6 igc package definition](https://github.com/openwrt/openwrt/blob/v25.12.6/package/kernel/linux/modules/netdevices.mk)
- [OpenWrt 25.12.6 x86-64 kernel configuration](https://github.com/openwrt/openwrt/blob/v25.12.6/target/linux/x86/64/config-6.12)

## Build the updated candidate on the Windows PC
Run in ordinary Windows PowerShell:
~~~
powershell.exe -NoProfile -ExecutionPolicy Bypass -File C:\moci-build\MoCI\scripts\Start-MoCI-Ship-Build.ps1 -Mode All -Jobs 20
~~~
Use the updated launcher and companion Bash script from this branch together. The launcher must print the new pinned source commit, not the original 45f23be commit. The source checkout is separate from the existing development checkout. Matching OpenWrt compilation outputs and downloaded packages are reused.

At completion, retain the firmware image, installer ISO, both SHA256SUMS files, source-versions.txt, openwrt-config.used and build.log. The root firmware checksum and installer checksum must both match before use.

## Repeat the VM acceptance checks on the new build
- Install the new ISO on a disposable UEFI VM disk.
- Verify first login, LAN, DHCP/DNS, WAN routing and LuCI fallback.
- Verify the session-expiry fix returns to login without persisting credentials or extending rpcd's session lifetime.
- Validate the selected app batch and a full router reboot. Accounts, app configuration and automatic LAN firewall rules must survive.
- Validate stop/remove/network recreation cleanup and WAN-side denial of the app ports.
- Exercise backup/restore and upgrade/recovery before treating the build as a production release.

## Inspect the physical PC before installing
Boot the installer USB in UEFI mode with a display and keyboard attached. Keep the production WAN disconnected during initial identification.

The installer now has a read-only hardware inventory menu. Alternatively, from the live console:
~~~
sudo /usr/local/sbin/moci-hardware-check
~~~
Check that the SATA/mSATA destination disk and all six Ethernet controllers appear. Record each physical jack's MAC address by connecting a cable to one port at a time and observing link/carrier. A chassis label is not proof of the Linux interface name.

Identify the Wi-Fi card from its PCI/USB vendor/device ID. Select its matching OpenWrt driver and firmware, then verify radio detection and the required AP/client mode. The presence of a mini-PCIe module does not establish AP capability. This candidate does not claim validated Wi-Fi support.

If there is existing data on the destination disk, back it up separately. The installer erases the selected disk after its explicit final confirmation.

## Install and make the first connection
1. Choose the intended SATA/mSATA destination disk.
2. Select WAN and LAN using the MAC addresses identified above. The installer maps those MACs to the interface names used by OpenWrt on first boot.
3. Set a unique administrator password and the LAN address. The default is 192.168.50.1/24.
4. Confirm the selected disk only after reviewing the installer summary.
5. Remove the USB/ISO and boot the installed system in UEFI mode.
6. Connect a test PC to the selected LAN jack. Use DHCP, or temporarily 192.168.50.2/24 with no gateway for a direct local test.
7. Open https://192.168.50.1/moci/ and complete the local certificate trust decision yourself.
8. Verify login, disk expansion, all six physical interfaces and temperature reporting. Only the chosen LAN interface is initially bridged; the other unassigned physical ports need deliberate configuration.
9. Connect WAN and test DNS, routing, link negotiation and sustained traffic. Confirm WAN clients cannot reach management or app ports.
10. Test reboot and cold power-on before replacing the working router.

From an installed OpenWrt console, the inventory helper is:
~~~
sh /usr/libexec/moci-hardware-check
~~~

## Remaining limits
VirtualBox testing does not verify physical I225 link stability, the Wi-Fi module, thermal behaviour, Secure Boot, watchdog recovery, 2.5 GbE throughput or real power-loss behaviour. The tests above establish whether this individual PC is ready for production.
