#!/usr/bin/env bash
# Runs Kiln's backend on its own (as the desktop app would start it), for `npm run dev` and `npm run electron:dev`.
# The environment passes on: HF_HUB_CACHE, KILN_STUDIO_PORT (5191), KILN_STUDIO_STUB=image,song, KILN_STUDIO_BUDGET_GB.
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"
jar="${KILN_STUDIO_JAR:-$here/server/kiln-studio-server.jar}"
[ -f "$jar" ] || { echo "No $jar: run npm run server:build first" >&2; exit 1; }
java="${KILN_STUDIO_JAVA:-${JAVA_HOME:+$JAVA_HOME/bin/}java}"
exec "$java" --enable-native-access=ALL-UNNAMED "-Dkiln.library.path=${KILN_LIBRARY_PATH:-$(dirname "$jar")/native}" -jar "$jar"
