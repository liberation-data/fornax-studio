#!/usr/bin/env bash
# Builds Kiln's backend for the studio (kiln-studio-server, in the Kiln checkout) and puts it, with Kiln's native
# libraries, in server/, where the desktop app starts it from and electron-builder packs it.
#
#   KILN_HOME      the Kiln checkout (default ../kiln)
#   KILN_NATIVE    the native libraries to ship (default $KILN_HOME/build/native/<os>-<arch>-<backend>, see native/build.sh)
#   KILN_BACKEND   vulkan (default) | hip | cuda | metal | cpu
#   KILN_STUDIO_REQUIRE_NATIVE   set (as a release build does) to fail when a native library is missing
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"
kiln="$(cd "${KILN_HOME:-$here/../kiln}" && pwd)"
case "$(uname -s)" in Darwin) os=macos ;; *) os=linux ;; esac
arch="$(uname -m)"; arch="${arch/aarch64/arm64}"; arch="${arch/amd64/x86_64}"
native="${KILN_NATIVE:-$kiln/build/native/$os-$arch-${KILN_BACKEND:-vulkan}}"

(cd "$kiln" && ./gradlew -q :kiln-studio-server:studioJar)
rm -rf "$here/server/native"
mkdir -p "$here/server/native"
cp "$kiln/kiln-studio-server/build/libs/kiln-studio-server.jar" "$here/server/"
# Only the engines the studio runs (native/build.sh vulkan llama sd acestep builds just these): not yue2.
libs=(libkiln_llama libstable-diffusion libkiln_acestep)
missing=()
for lib in "${libs[@]}"; do
  found=("$native/$lib".so "$native/$lib".dylib)
  copied=0
  for f in "${found[@]}"; do [ -f "$f" ] && cp "$f" "$here/server/native/" && copied=1; done
  [ $copied = 1 ] || missing+=("$lib")
done
if [ ${#missing[@]} = 0 ]; then
  echo "kiln-studio-server.jar and the native libraries from $native are in server/"
else
  echo "kiln-studio-server.jar is in server/; not found in $native: ${missing[*]} (build them with native/build.sh, or set KILN_NATIVE)" >&2
  [ -z "${KILN_STUDIO_REQUIRE_NATIVE:-}" ] || exit 1
fi
