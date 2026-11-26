#!/usr/bin/env bash
# Builds Fornax's backend for the studio (fornax-studio-server, in the Fornax checkout) and puts it, with Fornax's native
# libraries, in server/, where the desktop app starts it from and electron-builder packs it. When the checkout has the
# fornax command (fornax-cli), it puts that in server/fornax-cli too: bin/fornax, the launcher that the app's "Install fornax
# command…" renders onto PATH, and lib/, its jars. The natives jar is left out, since the app's natives are in
# server/native and the launcher it renders points there.
#
#   FORNAX_HOME      the Fornax checkout (default ../fornax)
#   FORNAX_CLI_HOME  the Fornax checkout to build fornax-cli from (default FORNAX_HOME); without fornax-cli the app has no fornax
#                  command, and its menu item is disabled
#   FORNAX_NATIVE    the native libraries to ship (default $FORNAX_HOME/build/native/<os>-<arch>-<backend>, see native/build.sh)
#   FORNAX_BACKEND   vulkan (default) | hip | cuda | metal | cpu
#   FORNAX_STUDIO_REQUIRE_NATIVE   set (as a release build does) to fail when a native library is missing
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"
fornax="$(cd "${FORNAX_HOME:-$here/../fornax}" && pwd)"
case "$(uname -s)" in Darwin) os=macos ;; *) os=linux ;; esac
arch="$(uname -m)"; arch="${arch/aarch64/arm64}"; arch="${arch/amd64/x86_64}"
cli_home="$(cd "${FORNAX_CLI_HOME:-$fornax}" && pwd)"
native="${FORNAX_NATIVE:-$fornax/build/native/$os-$arch-${FORNAX_BACKEND:-vulkan}}"

(cd "$fornax" && ./gradlew -q :fornax-studio-server:studioJar)
rm -rf "$here/server/native" "$here/server/fornax-cli"
mkdir -p "$here/server/native"
cp "$fornax/fornax-studio-server/build/libs/fornax-studio-server.jar" "$here/server/"
if [ -d "$cli_home/fornax-cli" ]; then
  (cd "$cli_home" && ./gradlew -q :fornax-cli:installDist)
  dist="$cli_home/fornax-cli/build/install/fornax-cli"
  mkdir -p "$here/server/fornax-cli/bin" "$here/server/fornax-cli/lib"
  cp "$dist/bin/fornax" "$dist/bin/fornax.cmd" "$here/server/fornax-cli/bin/"
  find "$dist/lib" -maxdepth 1 -name '*.jar' ! -name 'fornax-natives-*' -exec cp {} "$here/server/fornax-cli/lib/" \;
  echo "The fornax command (fornax-cli, from $cli_home) is in server/fornax-cli"
else
  echo "No fornax-cli in $cli_home: the app is built without the fornax command" >&2
fi
# Every engine the studio runs (native/build.sh vulkan llama sd acestep yue2 builds just these).
libs=(libfornax_llama libstable-diffusion libfornax_acestep libfornax_yue2)
missing=()
for lib in "${libs[@]}"; do
  found=("$native/$lib".so "$native/$lib".dylib)
  copied=0
  for f in "${found[@]}"; do [ -f "$f" ] && cp "$f" "$here/server/native/" && copied=1; done
  [ $copied = 1 ] || missing+=("$lib")
done
if [ ${#missing[@]} = 0 ]; then
  echo "fornax-studio-server.jar and the native libraries from $native are in server/"
else
  echo "fornax-studio-server.jar is in server/; not found in $native: ${missing[*]} (build them with native/build.sh, or set FORNAX_NATIVE)" >&2
  [ -z "${FORNAX_STUDIO_REQUIRE_NATIVE:-}" ] || exit 1
fi
