# MoCI engineering trade-offs, November 12, 2026

Status: working notes for the 0.11.1-rc.1 validation session on the MoCI3 VM.
Each entry records the decision, why it was taken, and what it costs. These are
deliberate choices, not accidents; revisit them when the constraints change.

## Runtime security model

### Hardened defaults with per-app reviewed exceptions

- **Decision:** every managed container starts read-only, as uid 65534, with all
  capabilities dropped, `no-new-privileges`, memory and PID limits. Anything
  an app genuinely needs (tmpfs scratch, writable rootfs, a specific UID, one
  or two capabilities, relaxed health timing) is granted only through an
  exact-match, app-specific template entry validated by the API.
- **Why:** the Store promises "as close to one-click as safely possible". A
  router control plane cannot ship permissive defaults; each exception is
  auditable in `app-templates.json` plus the mirrored allow-lists in
  `moci-docker-api`.
- **Cost:** apps whose upstream images assume root or writable root filesystems
  fail first install and need a reviewed profile before they work. This session
  that happened twice (CyberChef: Nginx scratch dirs; Homarr: root-owned nginx
  config rewrite at startup). The alternative - permissive defaults - would
  trade a class of silent exposures for a class of loud failures. Loud is
  preferred.

### Ports bound to the LAN IP only, never 0.0.0.0

- **Decision:** published app ports are always bound to the router's LAN address
  (`192.168.50.1:8081->80/tcp`), and the firewall adds one destination-specific
  `lan -> moci_docker` TCP rule per container.
- **Why:** kills the historic failure mode where an app answered on the WAN side
  by accident. Verified on 0.11.1: all app ports refused on the WAN address,
  listeners exist only on the LAN IP, and the only Docker-related forwarding in
  nftables is egress (`moci_docker -> wan`).
- **Cost:** if the LAN IP changes (DHCP LAN, renumbering), bindings and rules
  must be reconciled - the reconciler owns this, which is exactly why reboot
  and network-recreation tests are part of the acceptance set.

### Immutable digest pinning with a separate prepare step

- **Decision:** `prepare_app` resolves and pins `repository@sha256:<digest>`;
  installs and upgrades deploy the digest, never a floating tag. Tag/digest
  changes require a new approval.
- **Why:** upstream tags are mutable; a re-pull under the same tag could swap
  code into a reviewed profile.
- **Cost:** images age; security updates require re-approval instead of flowing
  silently. Accepted: on a router, silent code replacement is worse.

### Secrets generated and retained server-side

- **Decision:** initial credentials (Gotify admin password, Grafana, Homarr,
  n8n keys) are generated on the router, persisted in the stack config, shown
  once at install time, and never re-shown or exported without explicit action.
- **Cost:** a lost credential means the user must use the app's own recovery
  flow; MoCI deliberately has no "reveal password" button.

## Reliability model

### "Running" is never "reachable"

- **Decision:** the Store gates its OPEN link on a running managed container,
  warns when LAN firewall automation is not active, and validation treats a
  router-local HTTP 200 as insufficient until the same URL answers from the
  Windows client.
- **Why:** this exact gap (router-local 200, Windows timeout) was the original
  handoff bug and reappeared during this session when a manual compose bypassed
  the reconciler.
- **Cost:** honest statuses are slower to earn ("Candidate" until proven), and
  some apps stay unverified longer.

### Compose `--wait` with app-specific wait budgets

- **Decision:** installs wait for health, with a 180 s budget normally and a
  reviewed 480 s budget for slow-start profiles (Homarr) whose image health
  probe (30 s interval, 60 s start period, 3 retries) turns unhealthy before
  first-boot migrations finish.
- **Cost:** slow-start apps can still exceed the budget on a weak uplink, and
  compose's own failure surface grows. Homarr today remains **Candidate** for
  exactly this reason: first boot exceeded eight minutes on the lab NAT even
  with the relaxed profile. The profile is ready; the upstream startup cost is
  the open issue.

### Error messages deliberately hide Docker/Compose stderr

- **Decision:** the API returns generic messages ("Compose failed to start or
  update the service") because compose stderr can leak registry URLs and
  credentials into a browser session.
- **Cost:** field diagnosis requires router SSH and instrumentation. A future
  improvement would log sanitized causes to the router log so "Consult local
  router logs" has something to consult.

## Application-profile decisions from this session

| App | Decision | Trade-off |
| --- | --- | --- |
| CyberChef | Same exact-match Nginx tmpfs scratch set as IT Tools; stays read-only, uid 65534 | Allow-list grew by one audited app; any other app wanting tmpfs needs the same review |
| Homarr | Root startup with only CHOWN+DAC_OVERRIDE, writable rootfs, pre-created `/appdata/db`, relaxed health timing | Runs counter to the non-root ideal; justified by upstream startup script that rewrites `/etc/nginx/nginx.conf`. Still Candidate: first boot too slow to complete install |
| Volume initializer | Optional `dirs` (max 2, strict names) created before chown in the init container | Needed because Docker resets an *empty* volume's root ownership from the image on every mount; creating dirs first also makes the volume non-empty, which pins ownership. Verified live |
| Glance, Uptime Kuma, Gotify, Memos, Dashy, Homepage, ntfy, Beszel | Deployed under the standard hardened profile, verified from Windows | None observed; restart persistence spot-checked for Glance, Uptime Kuma, Gotify |

## Verification scope limits (accepted for now)

- **WAN negative tests** use binding scope + nftables policy + router-self probes
  on the WAN address; VirtualBox NAT cannot originate a true external client.
  Strong evidence, not a substitute for an external client on real hardware.
- **DHCP/DNS** proven with a real client (network-namespace veth on `br-lan`,
  lease 192.168.50.167 served, DNS recursion answered) plus passive IPv6
  RA/SLAAC observation; no physical client exercised.
- **Upgrade/recovery** deferred: needs a disposable VM and an interactive
  installer session. Recorded as a release gate, not silently skipped.
- **Sensitive-data apps** (File Browser, SFTPGo, Backrest, Filestash, n8n)
  remain approval-gated per app; no host-directory or Docker-socket mounts.
- **`docker0` is absent on this install** (kernel device missing while Docker's
  metadata still references it). Managed `br-*` networks and all apps are
  unaffected; ad-hoc `docker run` without `--network` fails. Unresolved
  observation, worth an upstream check before release.
- **Homarr first boot** exceeds every practical wait budget on the lab NAT.

## Process trade-offs

- **Local snapshot history vs upstream:** the working repo's history began as a
  snapshot import, so it must reach GitHub as a patch/commits against `cce43af`,
  never as a merge of the snapshot root.
- **Progressive app verification:** batches of small, fully verified apps before
  large or exotic ones; each app earns its own status. Slower than a bulk
  install sweep, but every "Verified" in the catalog stays true.
