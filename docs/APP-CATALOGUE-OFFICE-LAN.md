# MoCI Applications: Office LAN and Homelab Catalogue

The integrated catalogue now contains **73 discoverable applications**. It incorporates all 17 titles referenced in the [Technoyard home-server article](https://technoyard.com/2025/08/11/17-essential-docker-containers-for-home-server-setup-2025-guide/), plus office-focused software.

## Navigation
Applications -> App Store includes *All apps*, *Office LAN*, *Homelab* and *Office + Homelab* audience filters and category filtering. Each entry identifies the expected setup complexity, risk class and whether a reviewed installation template is available.

Office groups include:
- Files / storage: Nextcloud, Syncthing, Seafile, SFTPGo, Filestash, File Browser, MinIO
- Backups: Duplicati, Kopia, Backrest, Rest Server
- Documents / office: Paperless-ngx, ONLYOFFICE Docs, Collabora Online, CryptPad, Cal.com
- Projects / knowledge: Vikunja, Plane, Wekan, Outline, BookStack, Wiki.js, Memos, Karakeep
- Identity / security: Authentik, Authelia, LLDAP, ZITADEL, Vaultwarden
- Communication: Mattermost, Rocket.Chat, Jitsi Meet, ntfy, Gotify
- Monitoring / IT: Uptime Kuma, OpenSpeedTest, Grafana, Prometheus, Netdata, Beszel, Scrutiny, Dozzle
- Business: Invoice Ninja, Odoo, Dolibarr
- Remote access: RustDesk Server, MeshCentral, Apache Guacamole

## Intentional security constraints
The *catalogue listing* is not a promise that an app is installable, officially supported, up to date or appropriate for a router. Most new applications have `template_available: false`. The backend also requires a pinned immutable digest and allowlisted image before installation, and write methods are still globally disabled pending the non-root runtime security review.

For a production router, treat these as special cases:
- DNS: Pi-hole and AdGuard Home can conflict with native DNS and DHCP. Offer a dedicated isolated listening address / IP and a rollback plan. Never silently replace the router's primary DNS.
- Web ports: Nginx Proxy Manager may conflict with LuCI/MoCI ports 80/443. Require explicit network and port assignment.
- Host capabilities: Fail2Ban, Netdata, Scrutiny, Home Assistant and remote-access tools may require privileges, host networking, devices or mounts not allowed by the restricted managed Compose policy.
- Docker socket: Watchtower, Portainer and Dozzle can require root-equivalent Docker socket access. They must not be one-click installs under an ordinary app role.
- Data storage: Nextcloud, Seafile, Immich, document suites and databases need multi-container templates, durable volumes and verified backup/restore.
- Hardware limits: AI, video, office suites and heavy monitoring need measured resource estimates and reservation limits before installation on an appliance.

## Before enabling an installer
For each app, verify its current upstream maintainers and image distribution, license, supported CPU architecture, service dependencies, recommended Compose spec, authentication/first-run settings, persistent volumes, healthchecks, backups, and recovery. Pin immutable digests to approved multi-arch manifests, subject to the target x86_64 architecture. Check resource requirements and install-time port conflicts. Do not copy example credentials or `:latest` tags from tutorials.

## Firmware readiness
Catalogue and UI metadata changes are committed to `develop/docker-manager`. The firmware build is experimental. A successful catalogue test does not validate live deployments. Before flashing a production router, pass OpenWrt SDK compilation, dedicated non-root rpcd negative access tests, QEMU UEFI networking tests and spare-hardware validation.

