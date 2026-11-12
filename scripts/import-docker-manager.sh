#!/bin/sh
# Import the verified v0.7.0 development source into a checked-out MoCI fork.
# Usage: sh scripts/import-docker-manager.sh /path/to/moci-docker-phase7-0.7.0
set -eu
ROOT=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
SOURCE=${1:?Path to extracted moci-docker-phase7-0.7.0 is required}
[ -f "$SOURCE/moci-app-docker/files/manifest.json" ] || { echo "Missing v0.7.0 package" >&2; exit 1; }
[ -f "$SOURCE/moci-app-docker/files/moci-docker-api" ] || { echo "Missing Docker backend" >&2; exit 1; }
[ -f "$SOURCE/tests/test_phase7.py" ] || { echo "Missing v0.7.0 test suite" >&2; exit 1; }
[ -d "$ROOT/moci/js" ] || { echo "Not a MoCI checkout" >&2; exit 1; }
[ ! -e "$ROOT/integrations/docker-manager" ] || { echo "Import destination already exists. Review existing changes." >&2; exit 1; }
mkdir -p "$ROOT/integrations/docker-manager"
cp -R "$SOURCE/moci-app-docker" "$ROOT/integrations/docker-manager/"
cp -R "$SOURCE/tests" "$ROOT/integrations/docker-manager/"
cp -R "$SOURCE/security" "$ROOT/integrations/docker-manager/"
cp -R "$SOURCE/docs" "$ROOT/integrations/docker-manager/"
cp -R "$SOURCE/scripts" "$ROOT/integrations/docker-manager/"
cp -R "$SOURCE/.github" "$ROOT/integrations/docker-manager/"
[ -f "$ROOT/integrations/docker-manager/moci-app-docker/files/allowed-images.json" ] || exit 1
echo "Imported v0.7.0 into integrations/docker-manager; review changes and run tests before commit."
