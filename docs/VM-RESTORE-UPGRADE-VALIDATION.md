# Disposable VM validation

The working VM is MoCI3 (3164c3c8-a30a-4171-99ec-a4fc4bda96dd). Restore and flash tests must use a full disposable copy, not that VM. Only one copy may run on the management network at a time.

## Prepare the copy

Run from Windows PowerShell:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File C:\moci-build\MoCI\scripts\New-MoCI-ValidationVM.ps1
```

The helper checks the source VM identity, disk capacity requirements and source LAN MAC before requesting a graceful guest shutdown. It does not force power-off. A full clone is registered under C:\moci-build\validation-vms with the source MACs, preserving MAC-based interface assignment. It takes a powered-off before-release-validation snapshot and starts the clone only after confirming the source remains off. Details are written to artifacts/validation-vm/MoCI-Release-Test-TIMESTAMP.json. It never deletes an existing VM or image, flashes firmware or restores settings. Clone failure leaves the original preserved and powered off; inspect VirtualBox before restarting it. Never start the source while the clone runs.

PowerShell syntax was checked locally. Creation and boot require execution on the user's Windows session because the agent cannot access the VirtualBox COM server. Do not record clone creation as passed until the registered VM and boot are observed.

VirtualBox reference: https://docs.oracle.com/en/virtualization/virtualbox/7.2/user/vboxmanage.html (clonevm, full clone by default; keepallmacs preserves NIC addresses).

## Restore validation, pending

The clone record now exists for MoCI-Release-Test-20261113-124935, UUID 97b3d07b-5b50-4662-9d1e-86f3fa22a857. Its VM log records startup, the original log ends PoweredOff, and a fresh browser request reached the login page. These observations support proceeding, while the test helper rechecks live VM states before changes.

Run:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File C:\moci-build\MoCI\scripts\Test-MoCI-Restore.ps1
```

The helper refuses to continue unless the original is off, the recorded clone is running and its hardware UUID differs from the original. The guest independently verifies that UUID before restore. It refuses pending UCI edits, creates and validates a fresh backup, changes a temporary hostname and restores the backup using sysupgrade --restore-backup. The four core configuration files must match their baseline bytes. A downloaded private backup is checksum-verified before the clone is gracefully powered down and cold-started through VirtualBox. Post-boot configuration hashes, router checks and isolated-client checks must all pass before restore-summary.json records success. There is no firmware flash or forced power-off. This is a controlled shutdown/start test, not a simulated abrupt power failure or a fix for the UEFI warm-reset stall.

Results are stored under artifacts/restore-check-TIMESTAMP. Keep the configuration archive private. Root-only files under /root/restore-check-TIMESTAMP also retain the baseline on the test VM. Missing or failed reports stop the workflow and never imply a pass. Python compilation, PowerShell parsing and four restore safeguard regression tests passed locally; live restore/cold-start results remain pending.

The first live run stopped at the guest hardware UUID check before backup or mutation (artifacts/restore-check-20261113T125908Z-445865b3/restore-report.json). The wrapper incorrectly attempted to fetch a nonexistent backup afterward. The clone XML and VBox log confirm little-endian SMBIOS UUID encoding. The identity helper now accepts exactly the expected VM UUID and its corresponding SMBIOS byte-order representation, rejects the original VM in both forms, and reports actual/expected UUIDs on further mismatch. The shutdown guard uses the same identity helper. The wrapper now downloads the report first and stops on failure before retrieving backups or power-cycling. Six safeguard tests and syntax checks passed; successful live restore remains pending.

On the disposable VM, create a fresh configuration backup and verify its archive integrity and SHA-256. Record baseline LAN/WAN, DHCP/DNS and administrative access. Make a harmless identifiable configuration change, restore the backup and verify that the change is removed. Check restored configuration and post-boot DHCP, DNS and forwarding. Keep the original archive private and preserve the recovery snapshot. Account for the observed UEFI warm-reset stall separately from restore correctness.

## Upgrade validation, pending

The available Windows firmware image is rc.2, source 01c164c69030, with SHA-256 ee1b1eb5d17122bb10985a4c6ca65736a43d3b31b4916e8e60afdd10d2b0d07b. Its hash was verified locally, but it predates the UTF-8 and dashboard-action fixes and is not the next release candidate. Do not flash it as though it contains those changes.

Build the next pinned candidate using Start-MoCI-Ship-Build.ps1. Verify its exported image and manifest, installed source/version, preservation of configuration and client connectivity after upgrading the disposable VM. An installer ISO is not a sysupgrade payload. Failed image validation must leave Flash unavailable. Keep release_ready false until live evidence is recorded.
