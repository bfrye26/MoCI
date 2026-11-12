# MoCI Docker fork integration

Target: **bfrye26/MoCI**. Development branch: `develop/docker-manager`, based on upstream `dev`.

## Already committed on the integration branch

- Removed persistent plaintext router passwords and legacy auto-login from `moci/js/core.js`.
- Changed the ubus session token from `localStorage` to `sessionStorage` (still JavaScript-accessible).
- Removed the corresponding Remember Credentials checkbox.
- Added automated regression checks for accidental reintroduction of saved passwords.

These changes **do not** establish secure non-root authentication. Upstream MoCI's privileged root sessions remain a blocker. Docker write operations must not be enabled on a production router yet.

## Import the v0.7.0 Docker Manager package

1. Download `moci-docker-manager-0.7.0-compose-auth-fork-ready.zip` from the ChatGPT conversation.
2. Extract the ZIP. The source directory is `moci-docker-phase7-0.7.0`.
3. Clone this fork and check out `develop/docker-manager`.
4. Run `sh scripts/import-docker-manager.sh /path/to/moci-docker-phase7-0.7.0`.
5. Review imported sources. Run the Python tests and JavaScript checks, and validate the OpenWrt `Makefile`, `rpcd` ACL and dependencies against the SDK.
6. Commit the imported source only after the full package has been reviewed and tested.

The add-on will live under `integrations/docker-manager/moci-app-docker`. Its OpenWrt buildroot package should ultimately be copied or linked to `package/moci-app-docker` when generating firmware.

## Mandatory security gates before production deployment

- Introduce a non-root `rpcd` login with enforced per-method permissions.
- Remove broad root-equivalent web access, and verify negative tests for unrelated `uci`, `file exec` and service methods.
- Audit the privileged Docker backend and restrict the Docker socket to the backend only.
- Validate approved-image digest enforcement and Compose rejection tests on live OpenWrt.
- Confirm no management UI/API exposure on WAN.
- Build an x86-64 UEFI firmware image and boot it in QEMU.
- Validate rollback, power-loss recovery, low disk space, upgrades and a real x86 router.

## Status

Fork branch and credential patch: committed. Full v0.7.0 Docker source: **not yet uploaded to GitHub**. QEMU and physical-router tests: pending. Production readiness: blocked.
