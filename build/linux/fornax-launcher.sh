#!/bin/sh
# fornax-launcher.sh <resources> <file>: writes the fornax command to <file>, for the .deb and .rpm, whose after-install
# script runs it as root with the app's resources folder and /usr/bin/fornax. It renders the launcher the app ships
# (server/fornax-cli/bin/fornax) with the app's own Java, the fornax command's jars and the app's natives, the way the app's
# "Install fornax command…" does (fornax-command.cjs; the tests check the two agree).
#
# It leaves <file> alone when it is a fornax that isn't Fornax Studio's, and does nothing when this build has no fornax
# command. It never fails the install.
set -u
res=$1
out=$2
marker="# fornax-studio-launcher: Fornax Studio wrote this file, and its Uninstall fornax command removes it."
template=$res/server/fornax-cli/bin/fornax
lib=$res/server/fornax-cli/lib
[ -f "$template" ] && [ -d "$lib" ] || exit 0

if [ -e "$out" ] || [ -L "$out" ]; then
  if [ -L "$out" ] || ! head -n 5 "$out" | grep -q '^# fornax-studio-launcher'; then
    echo "Fornax Studio: $out is a fornax command that isn't Fornax Studio's; left as it is" >&2
    exit 0
  fi
fi
for p in @FORNAX_JAVA@ @FORNAX_CLI_LIB@ @FORNAX_LIBRARY_PATH@; do
  grep -qF "'$p'" "$template" || { echo "Fornax Studio: the fornax launcher has no '$p'; $out not written" >&2; exit 0; }
done

# A path as the replacement in sed's s|...|...|: a ' becomes '\'' (it goes inside single quotes), and \ & | are escaped.
esc() { printf '%s' "$1" | sed -e "s/'/'\\\\''/g" -e 's/[\\&|]/\\&/g'; }
java=$res/server/jre/bin/java
natives=$res/server/native

tmp=$out.fornax-studio-$$
# The #! line, the marker, then the rest with the placeholders filled in; a path left out keeps its placeholder, for
# the launcher's default. The sed expressions hold spaces when the paths do, so they go through set --.
render() {
  sed -n 1p "$template"
  printf '%s\n' "$marker"
  set -- -e 1d
  [ -e "$java" ] && set -- "$@" -e "s|'@FORNAX_JAVA@'|'$(esc "$java")'|"
  set -- "$@" -e "s|'@FORNAX_CLI_LIB@'|'$(esc "$lib")'|"
  [ -e "$natives" ] && set -- "$@" -e "s|'@FORNAX_LIBRARY_PATH@'|'$(esc "$natives")'|"
  sed "$@" "$template"
}
if render > "$tmp" && chmod 755 "$tmp" && mv -f "$tmp" "$out"; then
  :
else
  rm -f "$tmp"
  echo "Fornax Studio: could not write $out" >&2
fi
exit 0
