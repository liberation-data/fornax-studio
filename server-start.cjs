// server-start.cjs: how the desktop app knows its servers are up, and how it starts Kiln's. Apart from main.cjs, which
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
 * The command that starts Kiln's backend (kiln-studio-server), from the environment and what is on disk:
 *
 *   KILN_STUDIO_JAR      the server's jar; else server/kiln-studio-server.jar in the app (npm run server:build puts it there)
 *   KILN_LIBRARY_PATH    Kiln's native libraries; else server/native beside the jar
 *   KILN_STUDIO_JAVA     the java to run it with (25 or later); else $JAVA_HOME/bin/java; else java on the PATH
 *
 * `roots` are where the app's own files are: the resources folder when packaged, then the app's folder. The rest of
 * the environment passes on: HF_HUB_CACHE (where the models are), KILN_STUDIO_STUB, KILN_STUDIO_BUDGET_GB and so on.
 */
function backendCommand({ env = process.env, roots, port, parentPid, exists = fs.existsSync }) {
  const jar = env.KILN_STUDIO_JAR || roots.map(root => path.join(root, 'server', 'kiln-studio-server.jar')).find(p => exists(p));
  if (!jar) {
    throw new Error('Kiln Studio\'s server is not built. Run `npm run server:build` (it builds kiln-studio-server in the Kiln checkout at KILN_HOME), or set KILN_STUDIO_JAR.');
  }
  const libraries = env.KILN_LIBRARY_PATH || path.join(path.dirname(jar), 'native');
  const java = env.KILN_STUDIO_JAVA || (env.JAVA_HOME ? path.join(env.JAVA_HOME, 'bin', 'java') : 'java');
  return {
    command: java,
    args: ['--enable-native-access=ALL-UNNAMED', `-Dkiln.library.path=${libraries}`, '-jar', jar],
    env: { ...env, KILN_STUDIO_PORT: String(port), KILN_STUDIO_PARENT_PID: String(parentPid) },
  };
}

module.exports = { answers, waitForServer, backendCommand };
