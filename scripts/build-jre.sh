#!/usr/bin/env bash
# Builds the Java runtime the packaged app ships, into server/jre: jlink, from the JDK at JAVA_HOME (25 or later), with
# only the modules fornax-studio-server and the fornax command use (as jdeps finds them in the jars), so the app and the
# fornax command it installs need no Java installed. Run it
# after npm run server:build; electron-builder packs server/jre beside the jar, and the app runs server/jre/bin/java.
#
#   JAVA_HOME                  the JDK to link from (default: the one java on the PATH belongs to)
#   FORNAX_STUDIO_JRE_MODULES    the modules, comma-separated, instead of what jdeps finds
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"
jar="$here/server/fornax-studio-server.jar"
out="$here/server/jre"
[ -f "$jar" ] || { echo "No $jar: run npm run server:build first" >&2; exit 1; }
jdk="${JAVA_HOME:-$(dirname "$(dirname "$(readlink -f "$(command -v java)")")")}"
[ -x "$jdk/bin/jlink" ] || { echo "No jlink in $jdk: set JAVA_HOME to a JDK 25" >&2; exit 1; }

# The fornax command's jars too, when server:build put them in server/fornax-cli/lib.
jars=("$jar")
for cli in "$here"/server/fornax-cli/lib/*.jar; do [ -f "$cli" ] && jars+=("$cli"); done
modules="${FORNAX_STUDIO_JRE_MODULES:-$("$jdk/bin/jdeps" --multi-release 25 --ignore-missing-deps --print-module-deps "${jars[@]}")}"
rm -rf "$out"
"$jdk/bin/jlink" --add-modules "$modules" --strip-debug --no-man-pages --no-header-files --compress zip-6 --output "$out"
echo "A Java runtime with $modules is in server/jre ($(du -sh "$out" | cut -f1))"
"$out/bin/java" -version
