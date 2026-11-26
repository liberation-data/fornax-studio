#!/bin/bash
# The .deb's and .rpm's after-remove script: electron-builder's own (app-builder-lib 26.18.0,
# templates/linux/after-remove.tpl), as it is, then the kiln command. electron-builder fills in the ${...} macros, so
# the kiln part uses none.


# Delete the link to the binary
# update-alternatives --remove <name> <path>: 'path' must be the registered alternative binary,
# not the generic symlink — see https://man7.org/linux/man-pages/man1/update-alternatives.1.html
if type update-alternatives >/dev/null 2>&1; then
    update-alternatives --remove '${executable}' '/opt/${sanitizedProductName}/${executable}'
else
    rm -f '/usr/bin/${executable}'
fi

APPARMOR_PROFILE_DEST='/etc/apparmor.d/${executable}'

# Remove and unload apparmor profile.
if [ -f "$APPARMOR_PROFILE_DEST" ]; then
  # Unload the profile from the running kernel before deleting the file so the
  # policy is not left enforced until the next reboot.  Mirror the chroot guard
  # used in the after-install script — live AppArmor operations are not
  # meaningful inside a chroot.
  # https://wiki.debian.org/AppArmor/HowToUse
  if apparmor_status --enabled > /dev/null 2>&1; then
    if ! { [ -x '/usr/bin/ischroot' ] && /usr/bin/ischroot; } && hash apparmor_parser 2>/dev/null; then
      apparmor_parser --remove "$APPARMOR_PROFILE_DEST" || true
    fi
  fi
  rm -f "$APPARMOR_PROFILE_DEST"
fi
# The kiln command: /usr/bin/kiln goes when it is Kiln Studio's and the app has gone. An upgrade runs this after the
# new version's files are in place (dpkg's postrm upgrade, rpm's %postun with $1 = 1), so the app's kiln-cli is
# still there then, and the /usr/bin/kiln the new version just wrote stays.
if [ ! -e '/opt/${sanitizedProductName}/resources/server/kiln-cli' ] && [ -f /usr/bin/kiln ] && [ ! -L /usr/bin/kiln ] \
    && head -n 5 /usr/bin/kiln | grep -q '^# kiln-studio-launcher'; then
  rm -f /usr/bin/kiln
fi
