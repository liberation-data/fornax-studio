import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

// macOS (and Windows) file systems ignore case. There, an import of './Inspect' and one of './inspect' find the same
// file whichever extension it has, so Inspect.tsx and inspect.ts clash: the signed macOS build failed its type check
// on exactly that, while Linux CI, which tells them apart, passed. So it's checked here, as an import would see it.
const SCRIPT = /\.(m|c)?(j|t)sx?$/

export function caseClashes(files) {
  const seen = new Map()
  const clashes = []
  for (const f of files) {
    const key = f.replace(SCRIPT, '').toLowerCase() + (SCRIPT.test(f) ? '' : '\0')
    const other = seen.get(key)
    if (other !== undefined && other !== f) clashes.push(`${other} and ${f}`)
    else seen.set(key, f)
  }
  return clashes
}

describe('file names', () => {
  it('finds files an import or a case-blind file system would mistake for each other', () => {
    expect(caseClashes(['src/studio/Inspect.tsx', 'src/studio/inspect.ts'])).toEqual(['src/studio/Inspect.tsx and src/studio/inspect.ts'])
    expect(caseClashes(['README.md', 'readme.md'])).toEqual(['README.md and readme.md'])
    // Same name, different kinds of file: no import confuses them.
    expect(caseClashes(['src/studio/Inspect.tsx', 'src/studio/Inspect.test.ts'])).toEqual([])
    expect(caseClashes(['build/icon.png', 'build/icon.svg'])).toEqual([])
  })

  it('has no such files in the repository', () => {
    const files = execFileSync('git', ['ls-files'], { encoding: 'utf8' }).split('\n').filter(Boolean)
    expect(caseClashes(files)).toEqual([])
  })
})
