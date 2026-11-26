#!/bin/bash
# The .deb's and .rpm's after-remove script: electron-builder's own (app-builder-lib 26.18.0,
# templates/linux/after-remove.tpl), as it is, then the fornax command. electron-builder fills in the ${...} macros, so
# the fornax part uses none.


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
# The fornax command: /usr/bin/fornax goes when it is Fornax Studio's and the app has gone. An upgrade runs this after the
# new version's files are in place (dpkg's postrm upgrade, rpm's %postun with $1 = 1), so the app's fornax-cli is
# still there then, and the /usr/bin/fornax the new version just wrote stays.
if [ ! -e '/opt/${sanitizedProductName}/resources/server/fornax-cli' ] && [ -f /usr/bin/fornax ] && [ ! -L /usr/bin/fornax ] \
    && head -n 5 /usr/bin/fornax | grep -q '^# fornax-studio-launcher'; then
  rm -f /usr/bin/fornax
fi
