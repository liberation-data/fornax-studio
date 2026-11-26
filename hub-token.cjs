// hub-token.cjs: the Hugging Face token for gated models (Gemma, LTX), kept encrypted by the OS keychain through
// Electron's safeStorage (Keychain on macOS, the Secret Service or KWallet on Linux, DPAPI on Windows), in a file of its
// own in the app's data folder. The main process hands it to Fornax's backend, which holds it in memory only; the
// studio's page never sees it, only whether one is set.
const fs = require('fs');
const path = require('path');

/**
 * Where the token is kept, and how. `safeStorage` is Electron's; a test passes a fake. Saving refuses when the system
 * has no keychain to encrypt with (Linux without a Secret Service, where Electron would fall back to a fixed key).
 */
function tokenStore({ dir, safeStorage }) {
  const file = path.join(dir, 'hf-token.bin');
  const usable = () => safeStorage.isEncryptionAvailable()
    && !(typeof safeStorage.getSelectedStorageBackend === 'function' && safeStorage.getSelectedStorageBackend() === 'basic_text');
  return {
    /** Whether a token can be kept: the system has a keychain. */
    usable,
    /** The token, or null when none is kept (or it can't be decrypted, as after the keychain was reset). */
    read() {
      try {
        if (!fs.existsSync(file) || !usable()) return null;
        return safeStorage.decryptString(fs.readFileSync(file)) || null;
      } catch {
        return null;
      }
    },
    /** Keeps the token, encrypted; a blank one clears it. Returns whether one is kept now. */
    save(token) {
      const t = typeof token === 'string' ? token.trim() : '';
      if (!t) {
        fs.rmSync(file, { force: true });
        return false;
      }
      if (!usable()) throw new Error('This system has no keychain to keep the token in. Set HF_TOKEN before starting Fornax Studio instead.');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(file, safeStorage.encryptString(t), { mode: 0o600 });
      return true;
    },
  };
}

/** Gives the backend the token (null clears it); resolves to whether the backend has one now. */
async function sendToken(backend, token, fetchImpl = fetch) {
  const res = await fetchImpl(`${backend}/api/hub/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token: token ?? null }),
  });
  if (!res.ok) throw new Error(`the backend refused the token (HTTP ${res.status})`);
  return (await res.json()).tokenSet === true;
}

module.exports = { tokenStore, sendToken };
