// kiln-command.cjs: "Install kiln command…", as VS Code's "Install 'code' command in PATH". It renders the launcher
// that kiln-cli ships (server/kiln-cli/bin/kiln, which npm run server:build puts there) with the app's own Java, the
// kiln command's jars and the app's natives, and writes it as an executable `kiln` into a folder on PATH. Apart from
// main.cjs, which needs Electron and shows the dialogs, so a test can drive it.
//
// The launcher's contract is Kiln's (kiln-cli's bin/kiln, liberation-data/kiln#38): three placeholders, each inside
// single quotes, that an installer replaces with absolute paths, or leaves as they are for the launcher's default.
//
// build/linux/kiln-launcher.sh renders it the same way for the .deb and .rpm (/usr/bin/kiln), so the marker below is
// in both files, and the tests check they agree.
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

/** The line that marks a launcher as Kiln Studio's: only a file with it is replaced or removed without asking. */
const MARKER = "# kiln-studio-launcher: Kiln Studio wrote this file, and its Uninstall kiln command removes it.";

const PLACEHOLDERS = { java: '@KILN_JAVA@', lib: '@KILN_CLI_LIB@', natives: '@KILN_LIBRARY_PATH@' };

/** value as one sh word, in single quotes: a ' in it becomes '\''. */
function shellQuote(value) {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

/**
 * The launcher with Studio's paths in it: java, lib and natives are absolute paths, or undefined to leave that
 * placeholder for the launcher's default. The marker goes on the line after the #! line. A template without one of
 * the placeholders is a launcher this app doesn't know, so it is refused rather than written half-rendered.
 */
function renderLauncher(template, { java, lib, natives }) {
  let out = template;
  for (const [key, value] of Object.entries({ java, lib, natives })) {
    const token = `'${PLACEHOLDERS[key]}'`;
    if (!out.includes(token)) throw new Error(`The kiln launcher has no ${token} in it, so Kiln Studio can't fill it in.`);
    if (value === undefined || value === null) continue;
    if (!path.isAbsolute(value)) throw new Error(`Not an absolute path for ${PLACEHOLDERS[key]}: ${value}`);
    out = out.replace(token, () => shellQuote(value));
  }
  const newline = out.indexOf('\n');
  if (!out.startsWith('#!') || newline < 0) throw new Error('The kiln launcher has no #! line.');
  return `${out.slice(0, newline + 1)}${MARKER}\n${out.slice(newline + 1)}`;
}

/** The launcher for the kiln command the app ships (see bundledCli), rendered with the app's paths. */
function launcherFor(cli) {
  return renderLauncher(fs.readFileSync(cli.template, 'utf8'), cli);
}

/** True when text is a launcher Kiln Studio wrote: the marker in its first lines. */
function isStudioLauncher(text) {
  return text.split('\n', 5).some(line => line.startsWith('# kiln-studio-launcher'));
}

/**
 * The kiln command this app ships, or null when it has none (built from a Kiln without kiln-cli): its launcher
 * template, its jars, and the app's own java and natives when they are there (else the launcher's defaults), and
 * the root they were found in.
 * `roots` are where the app's files are, as for backendCommand: the resources folder when packaged, then the app's.
 */
function bundledCli({ roots, exists = fs.existsSync }) {
  for (const root of roots) {
    const server = path.join(root, 'server');
    const template = path.join(server, 'kiln-cli', 'bin', 'kiln');
    const lib = path.join(server, 'kiln-cli', 'lib');
    if (!exists(template) || !exists(lib)) continue;
    const java = path.join(server, 'jre', 'bin', 'java');
    const natives = path.join(server, 'native');
    return { root, template, lib, java: exists(java) ? java : undefined, natives: exists(natives) ? natives : undefined };
  }
  return null;
}

/**
 * Why kiln can't be installed from where the app runs now, or null. The launcher points into the app, so it must be
 * somewhere that stays: not a disk image or the copy macOS translocates an app to when it is opened from Downloads
 * (both go away), nor an AppImage's mount.
 */
function locationProblem({ platform, resourcesPath, env = process.env }) {
  if (platform === 'darwin') {
    if (resourcesPath.startsWith('/Volumes/')) {
      return 'Kiln Studio is running from its disk image. Drag it into Applications, open it from there, and install the kiln command again.';
    }
    if (resourcesPath.includes('/AppTranslocation/')) {
      return 'macOS is running Kiln Studio from a temporary copy. Move it into Applications, open it from there, and install the kiln command again.';
    }
  }
  if (platform === 'linux' && (env.APPIMAGE || resourcesPath.startsWith('/tmp/.mount_'))) {
    return 'Kiln Studio is running as an AppImage, whose files go away when it quits. Install the .deb or .rpm to get the kiln command.';
  }
  return null;
}

/**
 * Where kiln goes, in the order the app offers them. admin: writing there may need an administrator's password.
 * TODO(windows): there is no Windows build yet. When there is, render bin/kiln.cmd (its placeholders are the same,
 * in a `set "KILN_DEFAULT_...=@...@"` line) into %LOCALAPPDATA%\Programs\Kiln Studio\bin and add that to the user's
 * PATH (HKCU\Environment), as VS Code does.
 */
function installTargets({ platform, home }) {
  const local = { dir: path.join(home, '.local', 'bin'), admin: false };
  if (platform === 'darwin') return [{ dir: '/usr/local/bin', admin: true }, local];
  if (platform === 'linux') return [local];
  return [];
}

/** 'absent', 'studio' (a launcher Kiln Studio wrote) or 'other' (anything else there, a symlink included). */
function launcherState(file) {
  let stat;
  try {
    stat = fs.lstatSync(file);
  } catch {
    return 'absent';
  }
  if (!stat.isFile()) return 'other';
  try {
    const fd = fs.openSync(file, 'r');
    const head = Buffer.alloc(4096);
    const n = fs.readSync(fd, head, 0, head.length, 0);
    fs.closeSync(fd);
    return isStudioLauncher(head.subarray(0, n).toString('utf8')) ? 'studio' : 'other';
  } catch {
    return 'other';
  }
}

/** Writes the launcher as an executable file, replacing what is there in one step (a rename). */
function writeLauncher(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.kiln-studio-${process.pid}`;
  try {
    fs.writeFileSync(tmp, content, { mode: 0o755 });
    fs.chmodSync(tmp, 0o755);
    fs.renameSync(tmp, file);
  } catch (error) {
    fs.rmSync(tmp, { force: true });
    throw error;
  }
}

/** Removes file if it is Kiln Studio's launcher; answers whether it did. */
function removeLauncher(file) {
  if (launcherState(file) !== 'studio') return false;
  fs.unlinkSync(file);
  return true;
}

/** True when dir is one of PATH's folders. */
function onPath(dir, PATH = '') {
  const norm = p => p.replace(/\/+$/, '') || '/';
  return PATH.split(path.delimiter).filter(Boolean).some(p => norm(p) === norm(dir));
}

/**
 * The PATH a new terminal gets: the login shell's (a desktop app's own PATH is often shorter), else env.PATH. An rc
 * file that hangs or waits must not hold up the install: an interactive bash ignores SIGTERM, and a child it started
 * can keep its output open, so after timeout the shell is killed and env.PATH answers.
 */
function terminalPath({ shell, env = process.env, timeout = 5000 } = {}) {
  const fallback = env.PATH ?? '';
  return new Promise(resolve => {
    const child = execFile(shell || env.SHELL || '/bin/sh', ['-ilc', 'printf "\n__KILN_PATH__%s__KILN_PATH__\n" "$PATH"'], { env },
      (error, stdout) => {
        clearTimeout(timer);
        const found = /__KILN_PATH__(.*)__KILN_PATH__/.exec(stdout ?? '');
        resolve(found ? found[1] : fallback);
      });
    const timer = setTimeout(() => { child.kill('SIGKILL'); resolve(fallback); }, timeout);
  });
}

/**
 * The sh command that puts the launcher at tmp into dir as file, as an administrator: copied beside file, then renamed
 * over it, so a symlink there is replaced rather than written through (cp would overwrite what it points to).
 */
function adminInstallCommand({ tmp, dir, file }) {
  const next = `${file}.kiln-studio-new`;
  return `mkdir -p ${shellQuote(dir)} && cp ${shellQuote(tmp)} ${shellQuote(next)} && chmod 755 ${shellQuote(next)} && mv -f ${shellQuote(next)} ${shellQuote(file)}`;
}

/** An AppleScript that runs the sh command as an administrator, after macOS asks for the password. */
function adminScript(command) {
  const escaped = command.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return `do shell script "${escaped}" with administrator privileges`;
}

module.exports = {
  MARKER, PLACEHOLDERS, shellQuote, renderLauncher, launcherFor, isStudioLauncher, bundledCli, locationProblem, installTargets,
  launcherState, writeLauncher, removeLauncher, onPath, terminalPath, adminInstallCommand, adminScript,
};
