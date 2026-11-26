import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const k = require('./kiln-command.cjs')
const here = path.dirname(fileURLToPath(import.meta.url))
const helper = path.join(here, 'build', 'linux', 'kiln-launcher.sh')
const realTemplate = path.join(here, 'server', 'kiln-cli', 'bin', 'kiln')

// The shape of kiln-cli's bin/kiln: the three placeholders in single quotes, each one treated as unset when left.
const TEMPLATE = `#!/bin/sh
# a launcher
KILN_DEFAULT_JAVA='@KILN_JAVA@'
KILN_DEFAULT_CLI_LIB='@KILN_CLI_LIB@'
KILN_DEFAULT_LIBRARY_PATH='@KILN_LIBRARY_PATH@'
unrendered() { case "$1" in @*@) return 0 ;; *) return 1 ;; esac; }
unrendered "$KILN_DEFAULT_JAVA" && KILN_DEFAULT_JAVA=
unrendered "$KILN_DEFAULT_CLI_LIB" && KILN_DEFAULT_CLI_LIB=
unrendered "$KILN_DEFAULT_LIBRARY_PATH" && KILN_DEFAULT_LIBRARY_PATH=
printf '%s\\n' "java=$KILN_DEFAULT_JAVA" "lib=$KILN_DEFAULT_CLI_LIB" "natives=$KILN_DEFAULT_LIBRARY_PATH"
`

let tmp
beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kiln-command-')) })
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }))

/** An app's resources folder as the packages lay it out, at dir: server/kiln-cli, and its jre and natives. */
function resources(dir, { template = TEMPLATE, jre = true, natives = true } = {}) {
  fs.mkdirSync(path.join(dir, 'server', 'kiln-cli', 'bin'), { recursive: true })
  fs.mkdirSync(path.join(dir, 'server', 'kiln-cli', 'lib'))
  fs.writeFileSync(path.join(dir, 'server', 'kiln-cli', 'bin', 'kiln'), template)
  if (jre) {
    fs.mkdirSync(path.join(dir, 'server', 'jre', 'bin'), { recursive: true })
    fs.writeFileSync(path.join(dir, 'server', 'jre', 'bin', 'java'), '#!/bin/sh\n', { mode: 0o755 })
  }
  if (natives) fs.mkdirSync(path.join(dir, 'server', 'native'))
  return dir
}

describe('renderLauncher', () => {
  it('fills in each placeholder with a quoted absolute path, and marks the file as Kiln Studio\'s after the #! line', () => {
    const out = k.renderLauncher(TEMPLATE, { java: '/opt/Kiln Studio/jre/bin/java', lib: '/opt/Kiln Studio/lib', natives: '/opt/Kiln Studio/native' })
    const lines = out.split('\n')
    expect(lines[0]).toBe('#!/bin/sh')
    expect(lines[1]).toBe(k.MARKER)
    expect(out).toContain("KILN_DEFAULT_JAVA='/opt/Kiln Studio/jre/bin/java'")
    expect(out).toContain("KILN_DEFAULT_CLI_LIB='/opt/Kiln Studio/lib'")
    expect(out).toContain("KILN_DEFAULT_LIBRARY_PATH='/opt/Kiln Studio/native'")
    expect(out).not.toMatch(/@KILN_/)
    expect(k.isStudioLauncher(out)).toBe(true)
  })

  it('leaves a placeholder with no path, for the launcher\'s default', () => {
    const out = k.renderLauncher(TEMPLATE, { lib: '/lib' })
    expect(out).toContain("KILN_DEFAULT_JAVA='@KILN_JAVA@'")
    expect(out).toContain("KILN_DEFAULT_LIBRARY_PATH='@KILN_LIBRARY_PATH@'")
  })

  it('gives sh back the paths exactly, spaces, quotes and $ included', () => {
    const java = "/Users/o'brien/Kiln Studio $HOME/java"
    const file = path.join(tmp, 'kiln')
    fs.writeFileSync(file, k.renderLauncher(TEMPLATE, { java, lib: '/a & b', natives: undefined }))
    expect(execFileSync('sh', [file], { encoding: 'utf8' }).split('\n')).toEqual([`java=${java}`, 'lib=/a & b', 'natives=', ''])
  })

  it('refuses a launcher without the placeholders, and a path that isn\'t absolute', () => {
    expect(() => k.renderLauncher(TEMPLATE.replace("'@KILN_CLI_LIB@'", "''"), { lib: '/lib' })).toThrow(/@KILN_CLI_LIB@/)
    expect(() => k.renderLauncher(TEMPLATE, { lib: 'lib' })).toThrow(/absolute/)
    expect(() => k.renderLauncher(TEMPLATE.replace('#!/bin/sh\n', ''), {})).toThrow(/#!/)
  })
})

describe('launcherState, writeLauncher and removeLauncher', () => {
  it('replaces and removes only Kiln Studio\'s own launcher', () => {
    const file = path.join(tmp, 'bin', 'kiln')
    expect(k.launcherState(file)).toBe('absent')
    k.writeLauncher(file, k.renderLauncher(TEMPLATE, {}))
    expect(k.launcherState(file)).toBe('studio')
    expect(fs.statSync(file).mode & 0o777).toBe(0o755)
    expect(fs.readdirSync(path.dirname(file))).toEqual(['kiln'])
    expect(k.removeLauncher(file)).toBe(true)
    expect(fs.existsSync(file)).toBe(false)

    fs.writeFileSync(file, '#!/bin/sh\nexec java -jar someone-elses.jar\n')
    expect(k.launcherState(file)).toBe('other')
    expect(k.removeLauncher(file)).toBe(false)
    expect(fs.existsSync(file)).toBe(true)
  })

  it('counts a symlink as someone else\'s, even to a launcher of Kiln Studio\'s', () => {
    const studio = path.join(tmp, 'studio-kiln')
    k.writeLauncher(studio, k.renderLauncher(TEMPLATE, {}))
    fs.symlinkSync(studio, path.join(tmp, 'kiln'))
    expect(k.launcherState(path.join(tmp, 'kiln'))).toBe('other')
    expect(k.removeLauncher(path.join(tmp, 'kiln'))).toBe(false)
  })
})

describe('bundledCli', () => {
  it('finds the kiln command the app ships, with its own java and natives', () => {
    const res = resources(path.join(tmp, 'res'))
    const cli = k.bundledCli({ roots: [path.join(tmp, 'none'), res] })
    expect(cli).toEqual({
      root: res,
      template: path.join(res, 'server/kiln-cli/bin/kiln'),
      lib: path.join(res, 'server/kiln-cli/lib'),
      java: path.join(res, 'server/jre/bin/java'),
      natives: path.join(res, 'server/native'),
    })
  })

  it('leaves java and natives to the launcher when the app has none, and is null without kiln-cli', () => {
    const res = resources(path.join(tmp, 'res'), { jre: false, natives: false })
    expect(k.bundledCli({ roots: [res] })).toMatchObject({ java: undefined, natives: undefined })
    expect(k.bundledCli({ roots: [path.join(tmp, 'none')] })).toBeNull()
  })
})

describe('where kiln goes', () => {
  it('is ~/.local/bin on Linux, /usr/local/bin then ~/.local/bin on macOS, and nowhere yet on Windows', () => {
    expect(k.installTargets({ platform: 'linux', home: '/home/u' })).toEqual([{ dir: '/home/u/.local/bin', admin: false }])
    expect(k.installTargets({ platform: 'darwin', home: '/Users/u' })).toEqual([
      { dir: '/usr/local/bin', admin: true }, { dir: '/Users/u/.local/bin', admin: false },
    ])
    expect(k.installTargets({ platform: 'win32', home: 'C:\\Users\\u' })).toEqual([])
  })

  it('refuses a disk image, a translocated app and an AppImage, which all go away', () => {
    expect(k.locationProblem({ platform: 'darwin', resourcesPath: '/Volumes/Kiln Studio/Kiln Studio.app/Contents/Resources' })).toMatch(/disk image/)
    expect(k.locationProblem({ platform: 'darwin', resourcesPath: '/private/var/folders/x/AppTranslocation/ABC/d/Kiln Studio.app/Contents/Resources' })).toMatch(/temporary copy/)
    expect(k.locationProblem({ platform: 'darwin', resourcesPath: '/Applications/Kiln Studio.app/Contents/Resources' })).toBeNull()
    expect(k.locationProblem({ platform: 'linux', resourcesPath: '/opt/Kiln Studio/resources', env: {} })).toBeNull()
    expect(k.locationProblem({ platform: 'linux', resourcesPath: '/tmp/.mount_KilnAb/resources', env: {} })).toMatch(/AppImage/)
  })

  it('knows whether a folder is on PATH', () => {
    expect(k.onPath('/home/u/.local/bin', '/usr/bin:/home/u/.local/bin/:/bin')).toBe(true)
    expect(k.onPath('/home/u/.local/bin', '/usr/bin:/bin')).toBe(false)
    expect(k.onPath('/home/u/.local/bin', '')).toBe(false)
  })

  it('quotes the command for AppleScript', () => {
    expect(k.adminScript(`cp '/tmp/a "b"\\c' /usr/local/bin/kiln`))
      .toBe(`do shell script "cp '/tmp/a \\"b\\"\\\\c' /usr/local/bin/kiln" with administrator privileges`)
  })
})

describe('build/linux/kiln-launcher.sh (the .deb and .rpm\'s /usr/bin/kiln)', () => {
  const run = (res, out) => execFileSync('sh', [helper, res, out], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })

  it('writes the same launcher the menu item does', () => {
    const res = resources(path.join(tmp, "Kiln Studio's & co|x"))
    const out = path.join(tmp, 'kiln')
    run(res, out)
    expect(fs.readFileSync(out, 'utf8')).toBe(k.renderLauncher(TEMPLATE, k.bundledCli({ roots: [res] })))
    expect(fs.statSync(out).mode & 0o777).toBe(0o755)
    run(res, out)  // again, over its own
    expect(k.launcherState(out)).toBe('studio')
  })

  it('leaves the placeholders for an app without its own java or natives', () => {
    const res = resources(path.join(tmp, 'res'), { jre: false, natives: false })
    run(res, path.join(tmp, 'kiln'))
    expect(fs.readFileSync(path.join(tmp, 'kiln'), 'utf8')).toBe(k.renderLauncher(TEMPLATE, k.bundledCli({ roots: [res] })))
  })

  it('leaves someone else\'s kiln, and does nothing without kiln-cli', () => {
    const res = resources(path.join(tmp, 'res'))
    const out = path.join(tmp, 'kiln')
    fs.writeFileSync(out, '#!/bin/sh\necho theirs\n')
    run(res, out)
    expect(fs.readFileSync(out, 'utf8')).toBe('#!/bin/sh\necho theirs\n')
    run(path.join(tmp, 'none'), path.join(tmp, 'kiln2'))
    expect(fs.existsSync(path.join(tmp, 'kiln2'))).toBe(false)
  })

  it('carries the same marker as kiln-command.cjs', () => {
    expect(fs.readFileSync(helper, 'utf8')).toContain(`marker="${k.MARKER}"`)
  })
})

// kiln-cli's own launcher, when npm run server:build has put it in server/: rendered, it runs the java it names with
// the jars and natives it names.
describe.skipIf(!fs.existsSync(realTemplate))('kiln-cli\'s bin/kiln', () => {
  it('runs on the java, jars and natives the menu item writes in', () => {
    const res = resources(path.join(tmp, 'Kiln Studio'), { template: fs.readFileSync(realTemplate, 'utf8') })
    const java = path.join(res, 'server', 'jre', 'bin', 'java')
    fs.writeFileSync(java, '#!/bin/sh\nprintf "%s\\n" "natives=$KILN_LIBRARY_PATH" "$@"\n', { mode: 0o755 })
    const file = path.join(tmp, 'bin', 'kiln')
    k.writeLauncher(file, k.launcherFor(k.bundledCli({ roots: [res] })))
    const env = { PATH: '/usr/bin:/bin' }
    const lines = execFileSync(file, ['list'], { encoding: 'utf8', env }).trim().split('\n')
    expect(lines).toEqual([
      `natives=${path.join(res, 'server', 'native')}`, '--enable-native-access=ALL-UNNAMED',
      '-cp', `${path.join(res, 'server', 'kiln-cli', 'lib')}/*`, 'org.liberationdata.kiln.cli.Main', 'list',
    ])
  })
})
