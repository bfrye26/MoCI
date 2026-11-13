#!/usr/bin/env bash
# Builds the reviewed source in a separate worktree, reusing OpenWrt objects.
set -Eeuo pipefail
export PATH='/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'

moci_clean_release() {
    local source=$1 tag=$2 head wanted
    [[ -f "$source/include/toplevel.mk" ]] || return 1
    head=$(git -C "$source" rev-parse HEAD 2>/dev/null) || return 1
    wanted=$(git -C "$source" rev-parse "refs/tags/$tag^{commit}" 2>/dev/null) || return 1
    [[ "$head" == "$wanted" ]] || return 1
    git -C "$source" diff --quiet && git -C "$source" diff --cached --quiet
}

moci_select_openwrt() {
    local existing=$1 isolated=$2 tag=$3 repository=$4
    if moci_clean_release "$existing" "$tag"; then
        printf '%s\n' "$existing"
        return
    fi
    printf '[MoCI] Preserving existing OpenWrt checkout; preparing %s separately.\n' "$tag" >&2
    if [[ ! -e "$isolated" ]]; then
        git clone --depth 1 --single-branch --branch "$tag" "$repository" "$isolated" >&2 || return 1
    fi
    moci_clean_release "$isolated" "$tag" || {
        printf '[MoCI] Separate checkout is incomplete, modified, or on the wrong version: %s\n' "$isolated" >&2
        return 1
    }
    # Reuse downloaded package archives. Compiled objects from a different
    # OpenWrt release cannot safely be reused.
    if [[ -d "$existing/dl" && ! -e "$isolated/dl" && ! -L "$isolated/dl" ]]; then
        ln -s "$existing/dl" "$isolated/dl" || return 1
    fi
    printf '%s\n' "$isolated"
}

# Tests can source the selection functions without starting a build.
if [[ "${BASH_SOURCE[0]}" != "$0" ]]; then return 0; fi

mode=${1:-firmware}
jobs=${2:-20}
case "$mode" in firmware|all|check) ;; *) echo 'Mode must be firmware, all or check' >&2; exit 2;; esac
[[ "$jobs" =~ ^[0-9]+$ ]] && ((jobs>=1 && jobs<=64)) || exit 2
commit='8316245becc890824c3ea7300606392bb219ddc5'
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
printf '[MoCI] Source: %s\n[MoCI] OpenWrt: %s\n[MoCI] Jobs: %s\n' "$commit" "$openwrt" "$jobs"
df -h "$project_root"
if [[ "$mode" == check ]]; then
    if moci_clean_release "$openwrt" v25.12.6; then
        printf '[MoCI] Existing OpenWrt v25.12.6 objects can be reused.\n'
    else
        printf '[MoCI] Build will prepare ~/Projects/openwrt-ship-v25.12.6 and preserve the existing tree.\n'
    fi
    printf '[MoCI] Local prerequisites passed. No source or build files changed.\n'
    exit 0
fi
# This lock coordinates launches of this script. Also refuse an existing make
# process, including builds started with the older launchers.
exec 9>"$project_root/.moci-ship-build.lock"
flock -n 9 || die 'Another MoCI ship build is active.'
if pgrep -x make >/dev/null; then die 'An existing make process is active. Let that build finish first.'; fi
output="$project_root/MoCI-output/ship-${commit:0:12}-$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$output"
exec > >(tee -a "$output/build.log") 2>&1
trap 'rc=$?; printf "[MoCI] Build stopped (exit %s) at line %s. Log: %s/build.log\n" "$rc" "$LINENO" "$output" >&2' ERR
printf '[MoCI] Output: %s\n' "$output"
openwrt=$(moci_select_openwrt "$openwrt" "$project_root/openwrt-ship-v25.12.6" v25.12.6 https://github.com/openwrt/openwrt.git)
printf '[MoCI] Selected OpenWrt tree: %s\n' "$openwrt"
if ! git -C "$original" cat-file -e "$commit^{commit}" 2>/dev/null; then
    git -C "$original" fetch https://github.com/bfrye26/MoCI.git "$branch"
fi
git -C "$original" cat-file -e "$commit^{commit}" || die 'Reviewed source commit is unavailable.'
if [[ ! -e "$checkout" ]]; then
    git -C "$original" worktree add --detach "$checkout" "$commit"
fi
[[ $(git -C "$checkout" rev-parse HEAD) == "$commit" ]] || die 'Build checkout has a different commit.'
[[ -z $(git -C "$checkout" status --porcelain) ]] || die 'Build checkout contains local edits. They were preserved.'
if [[ -f "$openwrt/.config" ]]; then cp -p "$openwrt/.config" "$output/openwrt-config.before"; fi
cd "$checkout"
export PYTHONDONTWRITEBYTECODE=1
python3 tests/docker-store-contract.py
python3 tests/docker-firewall-reconcile.py
node tests/session-expiry.test.mjs
node tests/router-config.test.mjs
node tests/firmware-upgrade.test.mjs
python3 -m unittest discover -s integrations/docker-manager/tests -p 'test*.py'
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
