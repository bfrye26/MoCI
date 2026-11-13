# MoCI 0.11.1-rc.2

Status: source candidate prepared for a new build, not a production release.

## Core changes

- Reject failed UCI writes rather than displaying success.
- Reload DHCP/DNS services after saving affected settings.
- Round-trip checkbox values using UCI 1/0 strings.
- Apply connectivity-sensitive edits through rpcd rollback/confirmation.
- Explicitly revert restored staging after cancelled or unsuccessful confirmation when the router remains reachable.
- Invalidate firmware validation when another image is selected; reject incomplete uploads and require a successful sysupgrade test.
- Accept x86 .img and .img.gz upgrade images while rejecting installer ISOs.
- Preserve reviewed CyberChef/Homarr profiles from the preceding development session. Additional app expansion remains deferred.

## Validation performed

Live VM: LAN/WAN interfaces up, router-local DNS, five upstream pings, DNS record create/edit/delete with fresh service queries, reservation save/removal, and clean route configuration after the follow-up unconfirmed test. These do not establish external-client forwarding or kernel-level rollback after management connection loss.

Source: router configuration, session expiry, service control, firmware upgrade and release-interface JavaScript tests; frontend production build. The updated full Linux CI must pass before selecting the source for a firmware build.

## Run installed-router checks on the Windows PC

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File C:\moci-build\MoCI\scripts\Test-MoCI-Release.ps1
```

This performs bounded router checks and downloads a checksum-verified private configuration backup into a timestamped artifacts/release-check folder. It does not reboot, flash or restore. The JSON report deliberately keeps release_ready false until the remaining acceptance gates have evidence.

## Build the candidate after CI passes

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File C:\moci-build\MoCI\scripts\Start-MoCI-Ship-Build.ps1 -Mode All -Jobs 20
```

The launcher must be pinned to the CI-passing source commit for this candidate. The full firmware and ISO remain unbuilt until the command completes. A live UI update does not replace a full firmware image.

## Remaining release gates

1. Backup download integrity, followed by actual restore on a disposable VM.
2. Independent LAN client DHCP renewal, DNS and upstream forwarding.
3. Independent WAN client management/app rejection and intended forwarding behaviour.
4. Deliberate management connection loss during timed apply, with kernel/configuration recovery verified.
5. Upgrade a disposable clone from a checksum-verified image and confirm version, settings retention and recovery.
6. Reboot/cold-boot persistence.
7. Physical P09B/J4125 boot, SSD, all six I225-V ports, exact Wi-Fi chipset/driver/AP support and sustained operation.

Do not relabel an old rc.1 ISO as rc.2 or remove UNTESTED merely because source tests pass.
