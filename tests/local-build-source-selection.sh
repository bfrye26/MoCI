#!/usr/bin/env bash
set -Eeuo pipefail
root=$(cd "$(dirname "$0")/.." && pwd)
source "$root/scripts/build-ship-local.sh"
scratch=$(mktemp -d)
trap 'rm -rf -- "$scratch"' EXIT
origin="$scratch/origin"
git init -q "$origin"
git -C "$origin" config user.name 'MoCI test'
git -C "$origin" config user.email 'moci-test@localhost'
mkdir -p "$origin/include"
printf 'old\n' > "$origin/include/toplevel.mk"
git -C "$origin" add .
git -C "$origin" commit -qm 'old release'
git -C "$origin" tag v25.12.2
printf 'new\n' > "$origin/include/toplevel.mk"
git -C "$origin" commit -qam 'new release'
git -C "$origin" tag v25.12.6
git -C "$origin" tag another-tag-on-same-commit
git clone -q --branch v25.12.2 "$origin" "$scratch/existing"
before=$(git -C "$scratch/existing" rev-parse HEAD)
mkdir -p "$scratch/existing/dl"
printf 'cached' > "$scratch/existing/dl/archive"

# Older release is preserved; new checkout and package download cache selected.
selected=$(moci_select_openwrt "$scratch/existing" "$scratch/separate" v25.12.6 "$origin")
[[ "$selected" == "$scratch/separate" ]]
[[ $(git -C "$scratch/existing" rev-parse HEAD) == "$before" ]]
[[ $(cat "$scratch/separate/dl/archive") == cached ]]
moci_clean_release "$selected" v25.12.6

# A second launch reuses the prepared tree rather than cloning over it.
[[ $(moci_select_openwrt "$scratch/existing" "$scratch/separate" v25.12.6 "$origin") == "$selected" ]]

# Clean desired source is reused, even when multiple tags name the commit.
[[ $(moci_select_openwrt "$origin" "$scratch/unused" v25.12.6 "$origin") == "$origin" ]]
[[ ! -e "$scratch/unused" ]]

# Dirty existing source is left intact and routed to the separate checkout.
printf 'local edit\n' > "$origin/include/toplevel.mk"
[[ $(moci_select_openwrt "$origin" "$scratch/separate" v25.12.6 "$origin") == "$selected" ]]
[[ $(cat "$origin/include/toplevel.mk") == 'local edit' ]]

# A dirty separate checkout is refused without overwriting its edits.
printf 'preserve me\n' > "$scratch/separate/include/toplevel.mk"
if moci_select_openwrt "$scratch/existing" "$scratch/separate" v25.12.6 "$origin"; then
    echo 'ERROR: modified separate tree was accepted' >&2
    exit 1
fi
[[ $(cat "$scratch/separate/include/toplevel.mk") == 'preserve me' ]]
printf 'Local source selection: five preservation/reuse scenarios passed.\n'
