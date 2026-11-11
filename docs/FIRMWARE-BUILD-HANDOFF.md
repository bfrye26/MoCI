# MoCI x86-64 firmware build handoff
Development branch: develop/docker-manager
Base distribution: OpenWrt v25.12.2 x86-64 UEFI/ext4
Build workflow: .github/workflows/build-x86-uefi.yml

## Status
Build source and workflow committed; **not** compiled or boot-tested. A manually triggered workflow verifies the complete Docker add-on source is present before attempting to compile. The full v0.7.0 Docker Manager source must be imported under integrations/docker-manager/moci-app-docker first.

## Firmware components
MoCI, LuCI fallback, Docker Engine and CLI, Docker Compose, Samba4, WireGuard, DHCP/DNS, SQM, diagnostics and disk tools.

The build sets an 8 GiB ext4 root partition. It deliberately does not resize or format a 256 GB SSD automatically. The partition must be expanded or additional storage configured safely after installation.

## Open issues before calling firmware production-ready
1. Import Docker Manager v0.7.0 full source to the development branch and audit frontend/backend/ACL.
2. Validate rpcd dedicated non-root role through a live OpenWrt 25.12.2 VM; upstream MoCI still uses root sessions.
3. Compile custom packages and verify every requested package resolves in the OpenWrt build.
4. QEMU UEFI boot with two NICs; validate WAN/LAN mapping and admin UI isolated to LAN.
5. Exercise Docker Compose allowed/denied operations, image policy enforcement, low disk space and recovery.
6. Implement first-boot guided network/storage setup and Samba shares UI.
7. Complete upgrade and rollback testing and validate on spare x86 hardware.
8. Publish flashable firmware only after QEMU and hardware test gates pass.

No image is published by this workflow automatically. Resulting artifacts are labelled UNTESTED.
