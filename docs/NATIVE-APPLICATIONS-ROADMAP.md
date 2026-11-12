# Native MoCI Applications and homelab catalogue

Target: a first-party Applications screen inside MoCI with Docker inventory, Compose stacks, app catalogue, categories, and manual Compose management. Do not embed Portainer or provide the Docker Unix socket to browser code.

## v0.8.0 local source snapshot
The ChatGPT development package `moci-docker-firmware-0.8.0-appstore-source.zip` contains a working source-level implementation and 35 passing Python tests. This **source has not yet been committed to this branch**. Import and review the package under `integrations/docker-manager/moci-app-docker`.

## Catalogue entries
AdGuard Home, Uptime Kuma, Jellyfin, Home Assistant, Immich, Syncthing, Nextcloud, Vaultwarden, Gitea, Grafana, Prometheus, Paperless-ngx, Nginx Proxy Manager, Beszel.

The cards offer category filters, app descriptions, and installation availability. The initial single-service templates are for AdGuard Home and Uptime Kuma. All other apps require per-service reviewed templates, including support for dependencies, networks, permissions and storage before deployment can be enabled.

## Security requirements
- One-click installations are disabled until immutable image digests are approved in both `app-pins.json` and `allowed-images.json`.
- Install calls use a trusted template ID; browser code cannot supply an arbitrary command, image tag, mount, or privileged setting.
- Compose currently permits only an intentionally restricted JSON subset, not unrestricted arbitrary YAML.
- Default service ports bind to localhost. LAN exposure requires separately reviewed firewall and reverse-proxy rules.
- Never permit arbitrary host bind mounts, Docker socket mounting, privileged mode, host networking or unsandboxed commands by default.
- Enforce non-root authentication on a real OpenWrt runtime before enabling Docker write operations.

## Firmware release gates
Compile the OpenWrt 25.12.2 x86-64 EFI image in GitHub Actions, boot-test it under UEFI/QEMU with two NICs, validate every application template and hardware recovery, then produce a signed pre-release. Do not ship this firmware as production-ready before these gates pass.
