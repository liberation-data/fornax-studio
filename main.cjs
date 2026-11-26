// main.cjs: the desktop app. It starts Kiln's backend (kiln-studio-server, a JVM holding the models), then runs the
// studio's standalone Next.js server in Electron's own Node and opens a window on it. The page talks only to the Next.js
// server, which passes /api/* on to the backend, so the browser app works the same from npm start.
const { app, BrowserWindow, Menu, dialog, ipcMain, shell, utilityProcess } = require('electron');
const { spawn, execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { answers, waitForServer, backendCommand } = require('./server-start.cjs');
const kilnCommand = require('./kiln-command.cjs');

const PORT = process.env.PORT ?? '5190';
const URL = `http://localhost:${PORT}`;
const BACKEND_PORT = process.env.KILN_STUDIO_PORT ?? '5191';
const BACKEND = `http://127.0.0.1:${BACKEND_PORT}`;
const isDev = process.env.ELECTRON_DEV === '1';
const HOME = process.env.KILN_STUDIO_HOME ?? path.join(os.homedir(), '.kiln-studio');

// A log file, since a packaged app has no terminal to write to.
const logPath = path.join(os.tmpdir(), 'kiln-studio-electron.log');
const logStream = fs.createWriteStream(logPath, { flags: 'a' });

function log(...args) {
  if (logStream.writable) logStream.write(`[${new Date().toISOString()}] ${args.join(' ')}\n`);
  console.log(...args);
}

function logError(...args) {
  if (logStream.writable) logStream.write(`[${new Date().toISOString()}] ERROR: ${args.join(' ')}\n`);
  console.error(...args);
}

log('==================== Electron Starting ====================');
log('App path:', app.getAppPath());
log('ELECTRON_DEV:', process.env.ELECTRON_DEV);
log('Log file:', logPath);

app.setName('Kiln Studio');

const ICON = path.join(__dirname, 'build', 'icon.png');

// A second launch would find this one's servers on the ports and refuse to start; bring this one forward instead.
if (!app.requestSingleInstanceLock()) {
  log('[Electron] Already running; leaving it to that instance');
  app.exit(0);
}
app.on('second-instance', () => {
  const win = BrowserWindow.getAllWindows()[0];
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.focus();
});

let backendProcess = null;
let serverProcess = null;
let serverReady = false;

process.on('uncaughtException', error => logError('Uncaught exception:', error));
process.on('unhandledRejection', error => logError('Unhandled rejection:', error));

/*
 * Kiln's backend: a JVM that loads the models onto the GPU. It is told this app's pid and exits with it, so a model
 * never stays loaded after the app has gone, even if the app is killed rather than quit.
 */
async function startBackend() {
  const health = `${BACKEND}/api/health`;
  if (await answers(health)) {
    // In development the backend may be running already (npm run server), so it can be restarted on its own.
    if (isDev) {
      log('[Electron] Dev mode - using the Kiln backend already at', BACKEND);
      return;
    }
    throw new Error(`Another server already answers at ${BACKEND}. Stop it, or set KILN_STUDIO_PORT to a free port.`);
  }
  const roots = appRoots();
  const { command, args, env } = backendCommand({ roots, port: BACKEND_PORT, parentPid: process.pid });
  log('[Electron] Starting the Kiln backend:', command, args.join(' '));
  backendProcess = spawn(command, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
  backendProcess.stdout.on('data', data => log('[kiln]', data.toString().trim()));
  backendProcess.stderr.on('data', data => logError('[kiln]', data.toString().trim()));
  let exited = null;
  backendProcess.on('error', error => {
    exited = `The Kiln backend could not start (${command}): ${error.message}. Kiln needs Java 25: set JAVA_HOME or KILN_STUDIO_JAVA.`;
  });
  backendProcess.on('exit', code => {
    exited = exited ?? `The Kiln backend exited with code ${code} before it answered at ${BACKEND}`;
    log(`[kiln] Process exited with code ${code}`);
    backendProcess = null;
  });
  return waitForServer(health, { stopped: () => exited });
}

async function startServer() {
  // In development the Next.js dev server is already running.
  if (isDev) {
    log('[Electron] Dev mode - using the Next.js dev server at', URL);
    return waitForServer(URL);
  }

  const serverCwd = path.join(app.getAppPath(), '.next', 'standalone');
  const serverPath = path.join(serverCwd, 'server.js');
  log('[Electron] Starting the studio server:', serverPath);
  if (!fs.existsSync(serverPath)) throw new Error(`Server file not found at: ${serverPath}`);
  if (await answers(URL)) {
    throw new Error(`Another server already answers at ${URL}. Stop it (npm run dev, say), or set PORT to a free port.`);
  }

  // Electron's utilityProcess runs it in Electron's own Node, so no separate Node is needed.
  serverProcess = utilityProcess.fork(serverPath, [], {
    cwd: serverCwd,
    env: { ...process.env, PORT, HOSTNAME: 'localhost', KILN_STUDIO_SERVER: BACKEND },
    stdio: 'pipe',
  });
  serverProcess.stdout.on('data', data => log('[Next.js]', data.toString().trim()));
  serverProcess.stderr.on('data', data => logError('[Next.js Error]', data.toString().trim()));
  let exited = null;
  serverProcess.on('exit', code => {
    exited = `The studio server exited with code ${code} before it answered at ${URL}`;
    log(`[Next.js] Process exited with code ${code}`);
  });

  return waitForServer(URL, { stopped: () => exited });
}

function createWindow() {
  log('[Electron] Creating window');

  const win = new BrowserWindow({
    show: false,
    icon: ICON,
    backgroundColor: '#1a1210',
    ...(process.platform === 'darwin' ? { titleBarStyle: 'hidden' } : {}),
    webPreferences: { contextIsolation: true, sandbox: true, preload: path.join(__dirname, 'preload.cjs') },
  });

  // Only the studio's own server; in dev, eval too, for Next.js hot reload. Images and songs come from it as well.
  win.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    const scriptSrc = isDev ? "'self' 'unsafe-inline' 'unsafe-eval'" : "'self' 'unsafe-inline'";
    const csp = [
      `default-src 'self'`,
      `script-src ${scriptSrc}`,
      `style-src 'self' 'unsafe-inline'`,
      `img-src 'self' data: blob:`,
      `media-src 'self' blob:`,
      `connect-src 'self' ws://localhost:${PORT}`,
      `font-src 'self' data:`,
    ].join('; ');
    callback({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [csp] } });
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  win.maximize();
  win.show();
  // KILN_STUDIO_OPEN=chat,models opens those windows at start (the page reads ?open=).
  const start = process.env.KILN_STUDIO_OPEN ? `${URL}/?open=${encodeURIComponent(process.env.KILN_STUDIO_OPEN)}` : URL;
  log('[Electron] Loading URL:', start);
  win.loadURL(start);

  win.webContents.on('did-fail-load', (e, code, desc, url) => {
    logError('[Electron] did-fail-load:', JSON.stringify({ code, desc, url }));
  });
  if (process.env.ELECTRON_DEVTOOLS === '1') {
    win.webContents.openDevTools({ mode: 'detach' });
  }
  // For a screenshot of the app as it runs: KILN_STUDIO_CAPTURE=<file.png> saves the window once the page has settled.
  if (process.env.KILN_STUDIO_CAPTURE) {
    win.webContents.once('did-finish-load', () => setTimeout(async () => {
      const image = await win.webContents.capturePage();
      fs.writeFileSync(process.env.KILN_STUDIO_CAPTURE, image.toPNG());
      log('[Electron] Captured the window to', process.env.KILN_STUDIO_CAPTURE);
      if (process.env.KILN_STUDIO_CAPTURE_QUIT === '1') app.quit();
    }, Number(process.env.KILN_STUDIO_CAPTURE_DELAY ?? 4000)));
  }
}

/*
 * The kiln command: "Install kiln Command…" writes kiln-cli's launcher, rendered with this app's Java, jars and
 * natives, into a folder on PATH (kiln-command.cjs has the rendering and the checks). Linux: ~/.local/bin. macOS:
 * /usr/local/bin, with an administrator's password when it isn't writable, or ~/.local/bin. Windows: TODO, there is no
 * Windows build yet (see installTargets).
 */
function appRoots() {
  return [process.resourcesPath, app.getAppPath()].filter(Boolean);
}

function cliItems() {
  const cli = kilnCommand.bundledCli({ roots: appRoots() });
  if (kilnCommand.installTargets({ platform: process.platform, home: os.homedir() }).length === 0) return [];
  const missing = 'This build of Kiln Studio has no kiln command: it was built from a Kiln without kiln-cli.';
  return [
    {
      label: cli ? 'Install kiln Command…' : 'Install kiln Command… (not in this build)',
      enabled: Boolean(cli), toolTip: cli ? 'Put the kiln command on your PATH, so a terminal can run kiln' : missing,
      click: () => installKiln(cli).catch(error => commandError('install', error)),
    },
    {
      label: 'Uninstall kiln Command',
      click: () => uninstallKiln().catch(error => commandError('uninstall', error)),
    },
  ];
}

function commandError(what, error) {
  logError(`[Electron] Could not ${what} the kiln command:`, error);
  dialog.showMessageBox({ type: 'error', message: `Kiln Studio could not ${what} the kiln command`, detail: error.message });
}

/** Runs the sh command as an administrator, after macOS asks for the password. Resolves false when cancelled. */
function runAsAdmin(command) {
  return new Promise((resolve, reject) => {
    execFile('osascript', ['-e', kilnCommand.adminScript(command)], (error, stdout, stderr) => {
      if (!error) return resolve(true);
      if (/-128/.test(stderr)) return resolve(false);  // the user cancelled the password prompt
      reject(new Error(stderr.trim() || error.message));
    });
  });
}

/** The PATH a new terminal gets: the login shell's (a desktop app's own PATH is often shorter), else this process's. */
function terminalPath() {
  const sh = process.env.SHELL || '/bin/sh';
  return new Promise(resolve => {
    execFile(sh, ['-ilc', 'printf "\n__KILN_PATH__%s__KILN_PATH__\n" "$PATH"'], { timeout: 5000 }, (error, stdout) => {
      const found = /__KILN_PATH__(.*)__KILN_PATH__/.exec(stdout ?? '');
      resolve(found ? found[1] : process.env.PATH ?? '');
    });
  });
}

const tilde = p => (p.startsWith(os.homedir() + path.sep) ? `~${p.slice(os.homedir().length)}` : p);

async function installKiln(cli) {
  const problem = kilnCommand.locationProblem({ platform: process.platform, resourcesPath: cli.root });
  if (problem) {
    await dialog.showMessageBox({ type: 'warning', message: 'The kiln command can\'t be installed from here', detail: problem });
    return;
  }
  const targets = kilnCommand.installTargets({ platform: process.platform, home: os.homedir() });
  let target = targets[0];
  if (targets.length > 1) {
    const { response } = await dialog.showMessageBox({
      type: 'question', message: 'Where should the kiln command go?',
      detail: `${targets[0].dir} is on every terminal's PATH, and may ask for an administrator's password.\n${tilde(targets[1].dir)} is just for you, and needs no password, but may need adding to your PATH.`,
      buttons: targets.map(t => tilde(t.dir)).concat('Cancel'), defaultId: 0, cancelId: targets.length,
    });
    if (response === targets.length) return;
    target = targets[response];
  }
  const file = path.join(target.dir, 'kiln');
  if (kilnCommand.launcherState(file) === 'other') {
    const { response } = await dialog.showMessageBox({
      type: 'warning', message: `There is already a kiln command at ${tilde(file)}`,
      detail: 'Kiln Studio didn\'t install it. Replace it with Kiln Studio\'s?',
      buttons: ['Replace', 'Cancel'], defaultId: 1, cancelId: 1,
    });
    if (response !== 0) return;
  }
  const content = kilnCommand.launcherFor(cli);
  try {
    kilnCommand.writeLauncher(file, content);
  } catch (error) {
    if (!target.admin || !['EACCES', 'EPERM'].includes(error.code)) throw error;
    // /usr/local/bin is root's: write the launcher to a temporary file, then copy it there as an administrator.
    const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'kiln-studio-')), 'kiln');
    fs.writeFileSync(tmp, content, { mode: 0o755 });
    const q = kilnCommand.shellQuote;
    const done = await runAsAdmin(`mkdir -p ${q(target.dir)} && cp ${q(tmp)} ${q(file)} && chmod 755 ${q(file)}`)
      .finally(() => fs.rmSync(path.dirname(tmp), { recursive: true, force: true }));
    if (!done) return;
  }
  log('[Electron] Installed the kiln command at', file);
  const onPath = kilnCommand.onPath(target.dir, await terminalPath());
  const pathNote = onPath ? '' : `\n\n${tilde(target.dir)} isn't on your PATH yet. Add this line to your shell's profile (~/.bashrc, ~/.zshrc), then open a new terminal:\n\n    export PATH="$HOME/.local/bin:$PATH"`;
  await dialog.showMessageBox({
    type: 'info', message: 'The kiln command is installed',
    detail: `${tilde(file)} runs on Kiln Studio's own Java, from ${cli.root}. If you move Kiln Studio, install the command again.\n\nTry, in a new terminal:\n\n    kiln list${pathNote}`,
  });
}

async function uninstallKiln() {
  const targets = kilnCommand.installTargets({ platform: process.platform, home: os.homedir() });
  const removed = [];
  const left = [];
  for (const target of targets) {
    const file = path.join(target.dir, 'kiln');
    const state = kilnCommand.launcherState(file);
    if (state === 'other') left.push(file);
    if (state !== 'studio') continue;
    try {
      kilnCommand.removeLauncher(file);
    } catch (error) {
      if (!target.admin || !['EACCES', 'EPERM'].includes(error.code)) throw error;
      if (!(await runAsAdmin(`rm -f ${kilnCommand.shellQuote(file)}`))) return;
    }
    log('[Electron] Removed the kiln command at', file);
    removed.push(file);
  }
  const others = left.length ? `\n\nLeft ${left.map(tilde).join(' and ')} alone: Kiln Studio didn't install it.` : '';
  await dialog.showMessageBox({
    type: 'info',
    message: removed.length ? 'The kiln command is uninstalled' : 'Kiln Studio hasn\'t installed a kiln command',
    detail: (removed.length ? `Removed ${removed.map(tilde).join(' and ')}.` : `There is no kiln command of Kiln Studio's in ${targets.map(t => tilde(t.dir)).join(' or ')}.`) + others,
  });
}

function setMenu() {
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac ? [{
      label: app.getName(),
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        ...cliItems(),
        { type: 'separator' },
        { label: 'Open Log File', click: () => shell.showItemInFolder(logPath) },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    }] : [{ label: 'File', submenu: [...cliItems(), { type: 'separator' }, { role: 'quit' }] }]),
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' }, { role: 'redo' }, { type: 'separator' },
        { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' }, { role: 'forceReload' }, { role: 'toggleDevTools' }, { type: 'separator' },
        { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    { label: 'Window', submenu: [{ role: 'minimize' }, { role: 'zoom' }, ...(isMac ? [{ role: 'front' }] : [{ role: 'close' }])] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// Shows an image or song the studio made in the file manager: only a file in the studio's outputs, only from its page.
ipcMain.on('studio:show-file', (event, file) => {
  if (!event.senderFrame?.url.startsWith(URL) || typeof file !== 'string') return;
  const outputs = path.join(HOME, 'outputs') + path.sep;
  const resolved = path.resolve(file);
  if (resolved.startsWith(outputs) && fs.existsSync(resolved)) shell.showItemInFolder(resolved);
});

app.whenReady().then(async () => {
  log('[Electron] App ready');
  try {
    await startBackend();
    await startServer();
  } catch (error) {
    logError('[Electron] Failed to start:', error);
    dialog.showErrorBox('Kiln Studio could not start', `${error.message}\n\nThe log is at ${logPath}.`);
    app.quit();
    return;
  }
  serverReady = true;
  if (process.platform === 'darwin' && !app.isPackaged && fs.existsSync(ICON)) app.dock.setIcon(ICON);
  setMenu();
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (serverReady && BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on('before-quit', () => {
  if (serverProcess) {
    log('[Electron] Stopping the studio server');
    serverProcess.kill();
  }
  if (backendProcess) {
    // SIGTERM: the backend's shutdown hook unloads every model first.
    log('[Electron] Stopping the Kiln backend');
    backendProcess.kill('SIGTERM');
  }
  log('[Electron] App quitting');
  logStream.end();
});
