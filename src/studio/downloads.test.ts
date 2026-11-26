import { describe, expect, it } from 'vitest'
import type { CatalogueSet, PullProgress } from './api'
import { byteRate, catalogueEmpty, latest, offered, progressWords, setState, timeLeft } from './downloads'

const progress = (p: Partial<PullProgress>): PullProgress => ({
  id: 'flux2-klein', role: 'diffusion_model', file: 'flux.safetensors', index: 0, count: 3, phase: 'DOWNLOADING',
  bytesDone: 0, bytesTotal: 100, setBytesDone: 0, setBytesTotal: 100, fraction: 0, bytesPerSecond: 0, etaSeconds: null, ...p,
})

const set = (s: Partial<CatalogueSet>): CatalogueSet => ({
  id: 'x', aliases: [], kind: 'image', title: 'X', engine: 'stable-diffusion.cpp', license: null, gated: false, termsUrl: null,
  state: 'MISSING', bytesOnDisk: 0, parts: [], downloading: false, progress: null, ...s,
})

describe('timeLeft', () => {
  it('says seconds, minutes, then hours and minutes', () => {
    expect(timeLeft(0.2)).toBe('1 s')
    expect(timeLeft(45)).toBe('45 s')
    expect(timeLeft(180)).toBe('3 min')
    expect(timeLeft(3600)).toBe('1 h')
    expect(timeLeft(4800)).toBe('1 h 20 min')
  })
})

describe('progressWords', () => {
  it('says how much of how much, the rate and the time left', () => {
    const p = progress({ setBytesDone: 1.2 * 2 ** 30, setBytesTotal: 4.5 * 2 ** 30, fraction: 0.27, bytesPerSecond: 38 * 2 ** 20, etaSeconds: 90 })
    expect(progressWords(p)).toBe('1.20 GB of 4.50 GB · 38.0 MB/s · 2 min left')
    expect(byteRate(38 * 2 ** 20)).toBe('38.0 MB/s')
  })

  it('leaves out what it doesn\'t know yet', () => {
    expect(progressWords(progress({ setBytesDone: 512, setBytesTotal: -1, fraction: -1 }))).toBe('512 B')
    expect(progressWords(progress({ setBytesDone: 100, fraction: 1, bytesPerSecond: 10, etaSeconds: 0 }))).toBe('100 B of 100 B · 10 B/s')
  })

  it('says what it is doing before bytes arrive', () => {
    expect(progressWords(progress({ phase: 'CHECKING' }))).toBe('Checking flux.safetensors…')
    expect(progressWords(progress({ phase: 'WAITING' }))).toBe('Waiting for another download of flux.safetensors…')
  })
})

describe('setState', () => {
  it('says how much is on disk, or how far its download has got', () => {
    expect(setState(set({ state: 'PRESENT' }), null)).toEqual({ color: 'green', words: 'Downloaded' })
    expect(setState(set({ state: 'PARTIAL' }), null)).toEqual({ color: 'amber', words: 'Part downloaded' })
    expect(setState(set({}), null)).toEqual({ color: 'off', words: 'Not downloaded' })
    expect(setState(set({ downloading: true }), null).words).toBe('Downloading…')
    expect(setState(set({}), progress({ fraction: 0.426 })).words).toBe('Downloading 42%')
  })
})

describe('offered', () => {
  it('keeps the kinds the studio has windows for, in its order', () => {
    const sets = [set({ id: 'v', kind: 'video' }), set({ id: 's', kind: 'speech' }), set({ id: 'c', kind: 'chat' }), set({ id: 'i', kind: 'image' })]
    expect(offered(sets).map(s => s.id)).toEqual(['c', 'i', 'v'])
  })

  it('leaves out what is on disk, unless it is downloading or was just got', () => {
    const sets = [set({ id: 'got', state: 'PRESENT' }), set({ id: 'part', state: 'PARTIAL' }), set({ id: 'busy', state: 'PRESENT', downloading: true }),
      set({ id: 'just', state: 'PRESENT' })]
    expect(offered(sets, new Set(['just'])).map(s => s.id)).toEqual(['part', 'busy', 'just'])
  })
})

describe('catalogueEmpty', () => {
  it('says it is reading, that it could not, or that everything is on disk', () => {
    expect(catalogueEmpty(null, null)).toBe('Reading the catalogue…')
    expect(catalogueEmpty([], null)).toBe('Every model Fornax knows by name is downloaded.')
    expect(catalogueEmpty([], '404 Not Found')).toBe("Couldn't read Fornax's catalogue: 404 Not Found")
  })
})

describe('latest', () => {
  const deferred = <T,>() => {
    let resolve!: (v: T) => void, reject!: (e: unknown) => void
    const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
    return { promise, resolve, reject }
  }

  it('drops an earlier answer that comes after a later request', async () => {
    const take = latest()
    const seen: string[] = []
    const early = deferred<string>(), late = deferred<string>()
    take(early.promise, v => seen.push(v), () => seen.push('failed'))
    take(late.promise, v => seen.push(v), () => seen.push('failed'))
    late.resolve('downloading: false')
    early.resolve('downloading: true')
    await Promise.all([early.promise, late.promise])
    await Promise.resolve()
    expect(seen).toEqual(['downloading: false'])
  })

  it('drops an earlier failure too, and passes on the latest one', async () => {
    const take = latest()
    const seen: string[] = []
    const early = deferred<string>(), late = deferred<string>()
    take(early.promise, v => seen.push(v), () => seen.push('early failed'))
    take(late.promise, v => seen.push(v), e => seen.push(String(e)))
    early.reject(new Error('stale'))
    late.reject('ACCESS_DENIED')
    await Promise.allSettled([early.promise, late.promise])
    await Promise.resolve()
    expect(seen).toEqual(['ACCESS_DENIED'])
  })
})
