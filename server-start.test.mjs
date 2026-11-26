import { createServer } from 'node:http'
import { describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { answers, waitForServer, backendCommand, keptFromKiln } = require('./server-start.cjs')

describe('backendCommand', () => {
  it('runs the jar the app ships, with its native libraries, on java from JAVA_HOME', () => {
    const c = backendCommand({
      env: { JAVA_HOME: '/jdk', HF_HUB_CACHE: '/hf' }, roots: ['/res', '/app'], port: 5191, parentPid: 42,
      exists: p => p === '/app/server/fornax-studio-server.jar',
    })
    expect(c.command).toBe('/jdk/bin/java')
    expect(c.args).toEqual([
      '--enable-native-access=ALL-UNNAMED', '-Djava.awt.headless=true', '-Dfornax.library.path=/app/server/native', '-jar', '/app/server/fornax-studio-server.jar',
    ])
    expect(c.env).toMatchObject({ FORNAX_STUDIO_PORT: '5191', FORNAX_STUDIO_PARENT_PID: '42', HF_HUB_CACHE: '/hf', GGML_VK_MAX_NODES_PER_SUBMIT: '8' })
  })

  it('keeps a GGML_VK_MAX_NODES_PER_SUBMIT of the environment\'s own', () => {
    const c = backendCommand({ env: { GGML_VK_MAX_NODES_PER_SUBMIT: '100' }, roots: ['/app'], port: 1, parentPid: 1, exists: p => p.endsWith('.jar') })
    expect(c.env.GGML_VK_MAX_NODES_PER_SUBMIT).toBe('100')
  })

  it('prefers the packaged resources, and what the environment names', () => {
    const packaged = backendCommand({ env: { JAVA_HOME: '/jdk' }, roots: ['/res', '/app'], port: 1, parentPid: 1, exists: () => true })
    expect(packaged.args.at(-1)).toBe('/res/server/fornax-studio-server.jar')
    expect(packaged.command).toBe('/res/server/jre/bin/java')
    const named = backendCommand({
      env: { FORNAX_STUDIO_JAR: '/k.jar', FORNAX_LIBRARY_PATH: '/libs', FORNAX_STUDIO_JAVA: '/j25/java' }, roots: [], port: 1, parentPid: 1, exists: () => false,
    })
    expect(named.command).toBe('/j25/java')
    expect(named.args).toContain('-Dfornax.library.path=/libs')
    expect(named.args.at(-1)).toBe('/k.jar')
  })

  it('runs java from the PATH when there is no Java of its own or JAVA_HOME', () => {
    const c = backendCommand({ env: {}, roots: ['/app'], port: 1, parentPid: 1, exists: p => p.endsWith('.jar') })
    expect(c.command).toBe('java')
  })

  it('says how to build the server when there is none', () => {
    expect(() => backendCommand({ env: {}, roots: ['/app'], port: 1, parentPid: 1, exists: () => false })).toThrow(/npm run server:build/)
  })
})

describe('waitForServer', () => {
  it('resolves once the server answers, and fails at once when it has stopped', async () => {
    const server = createServer((_, res) => res.end('ok')).listen(0)
    await new Promise(r => server.once('listening', r))
    const url = `http://127.0.0.1:${server.address().port}`
    expect(await answers(url)).toBe(true)
    await waitForServer(url, { timeoutMs: 2000 })
    server.close()
    await expect(waitForServer('http://127.0.0.1:9', { timeoutMs: 5000, stopped: () => 'exited with code 1' })).rejects.toThrow('exited with code 1')
  })
})

describe('keptFromKiln', () => {
  const only = (...dirs) => p => dirs.includes(p)
  it('uses the new folder when there is nothing from before the rename', () => {
    expect(keptFromKiln('/h/.fornax-studio', '/h/.kiln-studio', only())).toBe('/h/.fornax-studio')
  })
  it('keeps the Kiln folder when it is the only one', () => {
    expect(keptFromKiln('/h/.fornax-studio', '/h/.kiln-studio', only('/h/.kiln-studio'))).toBe('/h/.kiln-studio')
  })
  it('uses the new folder once it exists', () => {
    expect(keptFromKiln('/h/.fornax-studio', '/h/.kiln-studio', only('/h/.kiln-studio', '/h/.fornax-studio'))).toBe('/h/.fornax-studio')
  })
})
