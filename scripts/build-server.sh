#!/usr/bin/env bash
# Builds Kiln's backend for the studio (kiln-studio-server, in the Kiln checkout) and puts it, with Kiln's native
# libraries, in server/, where the desktop app starts it from and electron-builder packs it.
#
#   KILN_HOME      the Kiln checkout (default ../kiln)
#   KILN_NATIVE    the native libraries to ship (default $KILN_HOME/build/native/<os>-<arch>-<backend>, see native/build.sh)
#   KILN_BACKEND   vulkan (default) | hip | cuda | metal | cpu
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"
kiln="$(cd "${KILN_HOME:-$here/../kiln}" && pwd)"
case "$(uname -s)" in Darwin) os=macos ;; *) os=linux ;; esac
arch="$(uname -m)"; arch="${arch/aarch64/arm64}"; arch="${arch/amd64/x86_64}"
native="${KILN_NATIVE:-$kiln/build/native/$os-$arch-${KILN_BACKEND:-vulkan}}"

(cd "$kiln" && ./gradlew -q :kiln-studio-server:studioJar)
mkdir -p "$here/server/native"
cp "$kiln/kiln-studio-server/build/libs/kiln-studio-server.jar" "$here/server/"
if [ -d "$native" ]; then
  cp "$native"/*.so "$native"/*.dylib "$here/server/native/" 2>/dev/null || true
  echo "kiln-studio-server.jar and the native libraries from $native are in server/"
else
  echo "kiln-studio-server.jar is in server/; no native libraries at $native (build them with native/build.sh, or set KILN_NATIVE)" >&2
fi
