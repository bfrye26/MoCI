# Unconfigured UPS and default Docker bridge repair

The lab UI showed nut-server enabled with SETUP NEEDED and no UPS driver, plus a portless docker0 bridge definition and an inactive docker interface. The handoff separately recorded a missing kernel docker0 while Docker metadata still referenced it. This is not inferred merely from a bridge reporting NO-CARRIER while idle.

The firmware now runs 93-moci-runtime-defaults once during first boot. Its Python helper uses UCI directly, so it does not depend on rpcd being started. An unconfigured nut-server is disabled; any driver section or manual ups.conf UPS definition preserves the server. nut-monitor is untouched, since it may monitor a remote UPS independently. Configured services remain available for deliberate activation.

For the recognised upstream Docker defaults only, the helper sets the docker0 device bridge_empty=1 and the protocol-none docker interface auto=1. A clean image is preseeded before dockerd boot creates its default UCI sections. netifd manages the persistent empty bridge, while Docker assigns its IP and container endpoints. Custom bridge ports, protocol, options, alternative daemon files and ambiguous duplicate device definitions are preserved. No firewall rules, network databases, volumes or managed bridges are removed.

## Apply to the disposable VM

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File C:\moci-build\MoCI\scripts\Apply-MoCI-Runtime-Fixes.ps1
```

The wrapper verifies the original VM is off and the test copy is running. The guest verifies its expected hardware UUID before changes. Pending UCI edits or running containers block live repair. The network configuration and previous UPS boot-enabled status are backed up under /root/runtime-fix-TIMESTAMP. For the default Docker configuration it reloads netifd's committed device settings, brings up docker, and restarts an idle dockerd only if its gateway is absent. This can briefly affect router service availability; do not interrupt it.

Validation checks the kernel bridge and Docker IPAM gateway, then pulls the official busybox:1.37 test image and runs a temporary container on Docker's default network. It tests DNS and HTTP egress without published ports, host mounts, extra capabilities or a custom network. The test container is removed; its image remains cached. Existing custom-network and container IDs must remain unchanged. Results are downloaded to artifacts/runtime-fix-TIMESTAMP/runtime-report.json. A failed validation is not a success claim; an applied configuration fix can remain in place for diagnosis. Use the private before/network backup or disposable VM snapshot for recovery if needed.

Local validation passed 11 runtime-default tests, 6 restore safeguards, 5 client-lease checks, Python compilation, PowerShell parsing and the release interface contract. Linux-only Docker contracts require CI because Windows lacks fcntl. Live repair, post-boot persistence and a clean image remain pending until their actual reports are read. The next firmware marker is 0.11.1-rc.4, distinct from earlier rc.2 binaries.

Primary upstream implementation references:

- https://github.com/openwrt/packages/blob/master/utils/dockerd/files/dockerd.init
- https://github.com/openwrt/packages/blob/master/net/nut/files/nut-server.init
- https://github.com/openwrt/packages/blob/master/net/nut/files/nut-monitor.init
