#!/usr/bin/env bash
# Builds the reviewed source in a separate worktree, reusing OpenWrt objects.
set -Eeuo pipefail
export PATH='/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'
mode=${1:-firmware}
jobs=${2:-20}
case "$mode" in firmware|all|check) ;; *) echo 'Mode must be firmware, all or check' >&2; exit 2;; esac
[[ "$jobs" =~ ^[0-9]+$ ]] && ((jobs>=1 && jobs<=64)) || exit 2
commit='45f23be12abec6dfbd16bc71e739c4203ad375b8'
branch='fix/docker-firewall-release-20261112'
project_root="$HOME/Projects"
original="$project_root/MoCI"
openwrt="$project_root/openwrt"
checkout="$project_root/MoCI-ship-${commit:0:12}"
die() { printf '[MoCI] %s\n' "$*" >&2; exit 1; }
[[ $(id -u) != 0 ]] || die 'Run as your regular Ubuntu user, not root.'
for command in git make gcc g++ python3 node npm flock sha256sum pgrep; do
    command -v "$command" >/dev/null || die "Missing $command in Ubuntu."
done
[[ -d "$original/.git" || -f "$original/.git" ]] || die "Existing MoCI checkout not found: $original"
[[ -f "$openwrt/include/toplevel.mk" ]] || die "Existing OpenWrt checkout not found: $openwrt"
[[ $(git -C "$openwrt" describe --tags --exact-match HEAD) == v25.12.6 ]] || die 'OpenWrt must already be pinned to v25.12.6. No reset was performed.'
git -C "$openwrt" diff --quiet && git -C "$openwrt" diff --cached --quiet || die 'OpenWrt has tracked edits. Preserve/review them before building.'
printf '[MoCI] Source: %s\n[MoCI] OpenWrt: %s\n[MoCI] Jobs: %s\n' "$commit" "$openwrt" "$jobs"
df -h "$project_root"
if [[ "$mode" == check ]]; then
    printf '[MoCI] Local prerequisites passed. No source or build files changed.\n'
    exit 0
fi
# This lock coordinates launches of this script. Also refuse an existing make
# process, including builds started with the older launchers.
exec 9>"$project_root/.moci-ship-build.lock"
flock -n 9 || die 'Another MoCI ship build is active.'
if pgrep -x make >/dev/null; then die 'An existing make process is active. Let that build finish first.'; fi
if ! git -C "$original" cat-file -e "$commit^{commit}" 2>/dev/null; then
    git -C "$original" fetch https://github.com/bfrye26/MoCI.git "$branch"
fi
git -C "$original" cat-file -e "$commit^{commit}" || die 'Reviewed source commit is unavailable.'
if [[ ! -e "$checkout" ]]; then
    git -C "$original" worktree add --detach "$checkout" "$commit"
fi
[[ $(git -C "$checkout" rev-parse HEAD) == "$commit" ]] || die 'Build checkout has a different commit.'
[[ -z $(git -C "$checkout" status --porcelain) ]] || die 'Build checkout contains local edits. They were preserved.'
output="$project_root/MoCI-output/ship-${commit:0:12}-$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$output"
exec > >(tee -a "$output/build.log") 2>&1
trap 'rc=$?; printf "[MoCI] Build stopped (exit %s) at line %s. Log: %s/build.log\n" "$rc" "$LINENO" "$output" >&2' ERR
printf '[MoCI] Output: %s\n' "$output"
if [[ -f "$openwrt/.config" ]]; then cp -p "$openwrt/.config" "$output/openwrt-config.before"; fi
cd "$checkout"
export PYTHONDONTWRITEBYTECODE=1
python3 tests/docker-store-contract.py
python3 tests/docker-firewall-reconcile.py
node tests/service-controls.test.mjs
node tests/release-interface-contract.mjs
npm install --no-audit --no-fund --package-lock=false --ignore-scripts
npm run build
OPENWRT_SRC="$openwrt" MOCI_SRC="$checkout" SOURCE_V07="$checkout/integrations/docker-manager" JOBS="$jobs" bash firmware/scripts/build.sh
target="$openwrt/bin/targets/x86/64"
shopt -s nullglob
images=("$target/"*ext4-combined-efi.img.gz)
[[ ${#images[@]} == 1 ]] || die 'Expected exactly one UEFI ext4 image. Inspect the build log.'
cp "${images[0]}" "$output/"
for artifact in "$target/"*.manifest "$target/"*buildinfo; do cp "$artifact" "$output/"; done
cp "$openwrt/.config" "$output/openwrt-config.used"
printf 'MOCI_COMMIT=%s\nOPENWRT_COMMIT=%s\n' "$commit" "$(git -C "$openwrt" rev-parse HEAD)" > "$output/source-versions.txt"
if [[ "$mode" == all ]]; then
    printf '[MoCI] Building installer ISO. Enter your Ubuntu sudo password when prompted.\n'
    sudo bash firmware/installer/build-live-iso.sh "$output/$(basename "${images[0]}")" "$output/installer"
    sudo chown -R "$(id -u):$(id -g)" "$output/installer"
fi
(cd "$output" && sha256sum ./*.img.gz > SHA256SUMS)
printf '\n[MoCI] Build completed. VM validation is still required before release.\n'
printf '[MoCI] Files: %s\n' "$output"
if command -v wslpath >/dev/null; then wslpath -w "$output"; fi
