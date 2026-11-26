#!/usr/bin/env bash
# Runs Fornax's backend on its own (as the desktop app would start it), for `npm run dev` and `npm run electron:dev`.
# The environment passes on: HF_HUB_CACHE, FORNAX_STUDIO_PORT (5191), FORNAX_STUDIO_STUB=image,song,video, FORNAX_STUDIO_BUDGET_GB.
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"
jar="${FORNAX_STUDIO_JAR:-$here/server/fornax-studio-server.jar}"
[ -f "$jar" ] || { echo "No $jar: run npm run server:build first" >&2; exit 1; }
# As the app starts it: short Vulkan submissions, so an LTX decode stays under amdgpu's compute timeout.
export GGML_VK_MAX_NODES_PER_SUBMIT="${GGML_VK_MAX_NODES_PER_SUBMIT:-8}"
java="${FORNAX_STUDIO_JAVA:-${JAVA_HOME:+$JAVA_HOME/bin/}java}"
exec "$java" --enable-native-access=ALL-UNNAMED "-Dfornax.library.path=${FORNAX_LIBRARY_PATH:-$(dirname "$jar")/native}" -jar "$jar"
