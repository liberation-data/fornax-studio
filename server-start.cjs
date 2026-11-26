// server-start.cjs: how the desktop app knows its servers are up, and how it starts Fornax's. Apart from main.cjs, which
// needs Electron, so a test can drive it.
const fs = require('fs');
const path = require('path');

/**
 * True when something answers at url within timeoutMs. Bounded, since a process that holds the port but
 * never answers would otherwise keep the app waiting for ever, past any timeout of the caller's.
 */
async function answers(url, timeoutMs = 2000) {
  try {
    await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(timeoutMs) });
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolves once the server at url answers, rather than after a guess at how long it takes to start.
 * stopped() answers why the server has stopped, or null while it runs: a server that has exited will
 * never answer, so the wait fails then rather than at the timeout.
 */
async function waitForServer(url, { timeoutMs = 30000, intervalMs = 250, stopped = () => null } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const reason = stopped();
    if (reason) throw new Error(reason);
    if (await answers(url, Math.max(1, deadline - Date.now()))) return;
    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }
  throw new Error(`The server did not answer at ${url} within ${timeoutMs / 1000}s`);
}

/**
 * The command that starts Fornax's backend (fornax-studio-server), from the environment and what is on disk:
 *
 *   FORNAX_STUDIO_JAR      the server's jar; else server/fornax-studio-server.jar in the app (npm run server:build puts it there)
 *   FORNAX_LIBRARY_PATH    Fornax's native libraries; else server/native beside the jar
 *   FORNAX_STUDIO_JAVA     the java to run it with (25 or later); else the app's own, server/jre/bin/java (scripts/build-jre.sh
 *                        puts it there, and a release ships it); else $JAVA_HOME/bin/java; else java on the PATH
 *
 * `roots` are where the app's own files are: the resources folder when packaged, then the app's folder. The rest of
 * the environment passes on: HF_HUB_CACHE (where the models are), FORNAX_STUDIO_STUB, FORNAX_STUDIO_BUDGET_GB and so on.
 * GGML_VK_MAX_NODES_PER_SUBMIT is 8 unless set: with ggml-vulkan's 100, one LTX video decode can outlast amdgpu's
 * compute timeout and lose the GPU (Fornax's docs/engine-notes.md). Other GPU backends don't read it.
 */
function backendCommand({ env = process.env, roots, port, parentPid, exists = fs.existsSync }) {
  const jar = env.FORNAX_STUDIO_JAR || roots.map(root => path.join(root, 'server', 'fornax-studio-server.jar')).find(p => exists(p));
  if (!jar) {
    throw new Error('Fornax Studio\'s server is not built. Run `npm run server:build` (it builds fornax-studio-server in the Fornax checkout at FORNAX_HOME), or set FORNAX_STUDIO_JAR.');
  }
  const libraries = env.FORNAX_LIBRARY_PATH || path.join(path.dirname(jar), 'native');
  const bundled = roots.map(root => path.join(root, 'server', 'jre', 'bin', 'java')).find(p => exists(p));
  const java = env.FORNAX_STUDIO_JAVA || bundled || (env.JAVA_HOME ? path.join(env.JAVA_HOME, 'bin', 'java') : 'java');
  return {
    command: java,
    // Headless: the server makes images with java.desktop's ImageIO, and on macOS a JVM that starts AWT otherwise shows
    // in the Dock as an app of its own.
    args: ['--enable-native-access=ALL-UNNAMED', '-Djava.awt.headless=true', `-Dfornax.library.path=${libraries}`, '-jar', jar],
    env: { GGML_VK_MAX_NODES_PER_SUBMIT: '8', ...env, FORNAX_STUDIO_PORT: String(port), FORNAX_STUDIO_PARENT_PID: String(parentPid) },
  };
}

// The folder to use for something that was named after Kiln before the rename: the new one, or the old one when only
// that exists, so settings and outputs from before the rename stay where they are.
function keptFromKiln(dir, old, isDirectory = p => { try { return fs.statSync(p).isDirectory(); } catch { return false; } }) {
  return !isDirectory(dir) && isDirectory(old) ? old : dir;
}

module.exports = { answers, waitForServer, backendCommand, keptFromKiln };
