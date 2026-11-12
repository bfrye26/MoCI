#!/bin/sh
# Read-only MoCI VirtualBox Docker LAN diagnostics.
# No changes to UCI, fw4, Docker, credentials or network interfaces.
set -u
export PATH=/usr/sbin:/usr/bin:/sbin:/bin

printf '\n=== MoCI Docker LAN diagnostic ===\n'
date -u '+UTC: %Y-%m-%dT%H:%M:%SZ'
printf 'LAN: '
ubus call network.interface.lan status 2>/dev/null | grep '"address"' | head -n 2 || :

printf '\n=== Containers and published host ports ===\n'
docker ps -a --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}' 2>&1 || :

printf '\n=== Docker bridge networks ===\n'
docker network ls --filter driver=bridge --format 'table {{.Name}}\t{{.ID}}\t{{.Driver}}' 2>&1 || :

printf '\n=== Firewall4 ownership (no secrets) ===\n'
uci -q show firewall 2>/dev/null | grep -E '^firewall\.(docker|moci_docker_)' | \
    grep -E '\.(name|device|src|dest|dest_ip|dest_port|target|proto|forward)=' | head -n 75 || :
printf 'Auto-firewall helper: '
if [ -x /usr/sbin/moci-docker-firewall ]; then
    printf 'installed\n'
    /usr/sbin/moci-docker-firewall plan 2>&1 || :
else
    printf 'not installed\n'
fi

printf '\n=== Router-local HTTP tests (NOT external LAN tests) ===\n'
for item in 'Uptime-Kuma:3001' 'Gotify:8084' 'IT-Tools:8081' 'OpenSpeedTest:3000'; do
    app=${item%%:*}
    port=${item##*:}
    printf '%s port %s: ' "$app" "$port"
    if wget -q -T 5 --spider "http://192.168.50.1:$port/" >/dev/null 2>&1; then
        printf 'HTTP responded locally\n'
    else
        printf 'no confirmed local HTTP response\n'
    fi
done

printf '\nNOTICE: Router-local HTTP success does NOT prove Windows LAN reachability.\n'
printf 'Review legacy Docker bridge ownership before running moci-docker-firewall sync.\n'
printf 'Never share compose.json or unredacted application logs (may include secrets).\n'
