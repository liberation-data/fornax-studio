import { createServer } from 'node:http'
import { describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const require = createRequire(import.meta.url)
const { tokenStore, sendToken } = require('./hub-token.cjs')

/** safeStorage as Electron has it, with a reversible "encryption" that never stores the token as it is. */
const fakeSafeStorage = (backend = 'gnome_libsecret', available = true) => ({
  isEncryptionAvailable: () => available,
  getSelectedStorageBackend: () => backend,
  encryptString: s => Buffer.from([...Buffer.from(s, 'utf8')].map(b => b ^ 0x5a)),
  decryptString: b => Buffer.from([...b].map(x => x ^ 0x5a)).toString('utf8'),
})

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'hub-token-'))

describe('tokenStore', () => {
  it('keeps the token encrypted, trimmed, and reads it back', () => {
    const dir = tmp()
    const store = tokenStore({ dir, safeStorage: fakeSafeStorage() })
    expect(store.read()).toBeNull()
    expect(store.save('  hf_secret_token \n')).toBe(true)
    const kept = fs.readFileSync(path.join(dir, 'hf-token.bin'))
    expect(kept.toString('utf8')).not.toContain('hf_secret_token')
    expect(fs.statSync(path.join(dir, 'hf-token.bin')).mode & 0o777).toBe(0o600)
    expect(store.read()).toBe('hf_secret_token')
  })

  it('clears it with a blank token', () => {
    const dir = tmp()
    const store = tokenStore({ dir, safeStorage: fakeSafeStorage() })
    store.save('hf_x')
    expect(store.save('   ')).toBe(false)
    expect(store.read()).toBeNull()
    expect(fs.existsSync(path.join(dir, 'hf-token.bin'))).toBe(false)
  })

  it('refuses to keep a token without a keychain to encrypt it with', () => {
    for (const s of [fakeSafeStorage('basic_text'), fakeSafeStorage('gnome_libsecret', false)]) {
      const dir = tmp()
      const store = tokenStore({ dir, safeStorage: s })
      expect(store.usable()).toBe(false)
      expect(() => store.save('hf_x')).toThrow(/no keychain/)
      expect(fs.existsSync(path.join(dir, 'hf-token.bin'))).toBe(false)
    }
  })

  it('reads nothing once the keychain is gone', () => {
    const dir = tmp()
    tokenStore({ dir, safeStorage: fakeSafeStorage() }).save('hf_x')
    expect(tokenStore({ dir, safeStorage: fakeSafeStorage('basic_text') }).read()).toBeNull()
  })

  it('reads nothing it cannot decrypt', () => {
    const dir = tmp()
    fs.writeFileSync(path.join(dir, 'hf-token.bin'), 'garbage')
    const broken = { ...fakeSafeStorage(), decryptString: () => { throw new Error('bad key') } }
    expect(tokenStore({ dir, safeStorage: broken }).read()).toBeNull()
  })
})

describe('sendToken', () => {
  it('posts the token to the backend and says whether it has one', async () => {
    const seen = []
    const server = createServer((req, res) => {
      let body = ''
      req.on('data', c => (body += c))
      req.on('end', () => {
        seen.push([req.method, req.url, JSON.parse(body), req.headers['x-fornax-studio-secret'] ?? null])
        res.setHeader('content-type', 'application/json')
        res.end(JSON.stringify({ tokenSet: JSON.parse(body).token != null }))
      })
    })
    await new Promise(r => server.listen(0, '127.0.0.1', r))
    const backend = `http://127.0.0.1:${server.address().port}`
    try {
      expect(await sendToken(backend, 'hf_secret_token', 'launch-secret')).toBe(true)
      expect(await sendToken(backend, null)).toBe(false)
      expect(seen).toEqual([['POST', '/api/hub/token', { token: 'hf_secret_token' }, 'launch-secret'], ['POST', '/api/hub/token', { token: null }, null]])
    } finally {
      server.close()
    }
  })

  it('throws when the backend refuses it, without the token in the message', async () => {
    const refusing = async () => ({ ok: false, status: 400, json: async () => ({}) })
    const error = await sendToken('http://127.0.0.1:1', 'hf_secret_token', undefined, refusing).catch(e => e)
    expect(error.message).toBe('the backend refused the token (HTTP 400)')
    expect(error.message).not.toContain('hf_secret_token')
  })
})
