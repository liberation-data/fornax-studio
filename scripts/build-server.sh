#!/usr/bin/env bash
# Builds Kiln's backend for the studio (kiln-studio-server, in the Kiln checkout) and puts it, with Kiln's native
# libraries, in server/, where the desktop app starts it from and electron-builder packs it. When the checkout has the
# kiln command (kiln-cli), it puts that in server/kiln-cli too: bin/kiln, the launcher that the app's "Install kiln
# Command…" renders onto PATH, and lib/, its jars. The natives jar is left out, since the app's natives are in
# server/native and the launcher it renders points there.
#
#   KILN_HOME      the Kiln checkout (default ../kiln)
#   KILN_CLI_HOME  the Kiln checkout to build kiln-cli from (default KILN_HOME); without kiln-cli the app has no kiln
#                  command, and its menu item is disabled
#   KILN_NATIVE    the native libraries to ship (default $KILN_HOME/build/native/<os>-<arch>-<backend>, see native/build.sh)
#   KILN_BACKEND   vulkan (default) | hip | cuda | metal | cpu
#   KILN_STUDIO_REQUIRE_NATIVE   set (as a release build does) to fail when a native library is missing
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"
kiln="$(cd "${KILN_HOME:-$here/../kiln}" && pwd)"
case "$(uname -s)" in Darwin) os=macos ;; *) os=linux ;; esac
arch="$(uname -m)"; arch="${arch/aarch64/arm64}"; arch="${arch/amd64/x86_64}"
cli_home="$(cd "${KILN_CLI_HOME:-$kiln}" && pwd)"
native="${KILN_NATIVE:-$kiln/build/native/$os-$arch-${KILN_BACKEND:-vulkan}}"

(cd "$kiln" && ./gradlew -q :kiln-studio-server:studioJar)
rm -rf "$here/server/native" "$here/server/kiln-cli"
mkdir -p "$here/server/native"
cp "$kiln/kiln-studio-server/build/libs/kiln-studio-server.jar" "$here/server/"
# Every engine the studio runs (native/build.sh vulkan llama sd acestep yue2 builds just these).
if [ -d "$cli_home/kiln-cli" ]; then
  (cd "$cli_home" && ./gradlew -q :kiln-cli:installDist)
  dist="$cli_home/kiln-cli/build/install/kiln-cli"
  mkdir -p "$here/server/kiln-cli/bin" "$here/server/kiln-cli/lib"
  cp "$dist/bin/kiln" "$dist/bin/kiln.cmd" "$here/server/kiln-cli/bin/"
  find "$dist/lib" -maxdepth 1 -name '*.jar' ! -name 'kiln-natives-*' -exec cp {} "$here/server/kiln-cli/lib/" \;
  echo "The kiln command (kiln-cli, from $cli_home) is in server/kiln-cli"
else
  echo "No kiln-cli in $cli_home: the app is built without the kiln command" >&2
fi
libs=(libkiln_llama libstable-diffusion libkiln_acestep libkiln_yue2)
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
