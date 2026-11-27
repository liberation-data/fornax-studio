import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

// macOS (and Windows) file systems ignore case. There, an import of './Inspect' and one of './inspect' find the same
// file whichever extension it has, so Inspect.tsx and inspect.ts clash: the signed macOS build failed its type check
// on exactly that, while Linux, which tells them apart, passed. So it's checked here, as an import would see it: a
// script (or its .d.ts) by its name without the extension, a folder by its name (an import of it finds its index), and
// any other file by its whole name.
const SCRIPT = /(\.d)?\.(m|c)?(j|t)sx?$/

export function caseClashes(files) {
  const seen = new Map()
  const clashes = new Set()
  const see = (key, name, shown) => {
    const other = seen.get(key)
    if (!other) seen.set(key, { name, shown })
    else if (other.name !== name) clashes.add(`${other.shown} and ${shown}`)
  }
  for (const f of files) {
    const parts = f.split('/')
    for (let i = 1; i < parts.length; i++) {
      const dir = parts.slice(0, i).join('/')
      see(dir.toLowerCase(), dir, dir)
    }
    const name = SCRIPT.test(f) ? f.replace(SCRIPT, '') : f
    see(name.toLowerCase() + (SCRIPT.test(f) ? '' : '\0'), name, f)
  }
  return [...clashes]
}

describe('file names', () => {
  it('finds files an import or a case-blind file system would mistake for each other', () => {
    expect(caseClashes(['src/studio/Inspect.tsx', 'src/studio/inspect.ts'])).toEqual(['src/studio/Inspect.tsx and src/studio/inspect.ts'])
    expect(caseClashes(['README.md', 'readme.md'])).toEqual(['README.md and readme.md'])
    // Same name, different kinds of file: no import confuses them.
    expect(caseClashes(['src/studio/Inspect.tsx', 'src/studio/Inspect.test.ts'])).toEqual([])
    expect(caseClashes(['build/icon.png', 'build/icon.svg'])).toEqual([])
  })

  it('finds directories that differ only in case, and an import that would find the other one', () => {
    // One folder on macOS, so the import naming the other spelling fails tsc's casing check.
    expect(caseClashes(['src/Studio/a.ts', 'src/studio/b.ts', 'src/studio/c.ts'])).toEqual(['src/Studio and src/studio'])
    // './foo' finds foo.ts, and './Foo' finds Foo/index.ts on Linux but foo.ts on macOS.
    expect(caseClashes(['src/foo.ts', 'src/Foo/index.ts'])).toEqual(['src/foo.ts and src/Foo'])
    // A declaration file is found by the same import as a script.
    expect(caseClashes(['src/Native.ts', 'src/native.d.ts'])).toEqual(['src/Native.ts and src/native.d.ts'])
    // The same spelling is no clash: a folder beside a script of its name, a declaration beside its script.
    expect(caseClashes(['src/foo.ts', 'src/foo/index.ts', 'src/bar.ts', 'src/bar.d.ts'])).toEqual([])
  })

  it('has no such files in the repository', () => {
    const files = execFileSync('git', ['ls-files'], { cwd: import.meta.dirname, encoding: 'utf8' }).split('\n').filter(Boolean)
    expect(caseClashes(files)).toEqual([])
  })
})
