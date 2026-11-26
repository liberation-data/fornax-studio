import type { CatalogueSet, PullProgress } from './api'
import { bytes } from './format'

/** A rate in words: "38 MB/s". */
export function byteRate(bytesPerSecond: number): string {
  return `${bytes(bytesPerSecond)}/s`
}

/** Time left in words: "45 s", "3 min", "1 h 20 min". */
export function timeLeft(seconds: number): string {
  if (seconds < 60) return `${Math.max(1, Math.round(seconds))} s`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} min`
  const h = Math.floor(minutes / 60), m = minutes % 60
  return m === 0 ? `${h} h` : `${h} h ${m} min`
}

/** A download's progress in words: "1.2 GB of 4.5 GB · 38 MB/s · 2 min left", or what it is doing before bytes arrive. */
export function progressWords(p: PullProgress): string {
  if (p.phase === 'CHECKING') return `Checking ${p.file}…`
  if (p.phase === 'WAITING') return `Waiting for another download of ${p.file}…`
  const parts = [p.setBytesTotal >= 0 ? `${bytes(p.setBytesDone)} of ${bytes(p.setBytesTotal)}` : bytes(p.setBytesDone)]
  if (p.bytesPerSecond > 0) parts.push(byteRate(p.bytesPerSecond))
  if (p.etaSeconds != null && p.fraction < 1) parts.push(`${timeLeft(p.etaSeconds)} left`)
  return parts.join(' · ')
}

/** What a catalogue row says of a set, and its light. */
export function setState(s: CatalogueSet, progress: PullProgress | null): { color: 'green' | 'amber' | 'off'; words: string } {
  if (s.downloading || progress) {
    const f = progress?.fraction ?? -1
    return { color: 'amber', words: f >= 0 ? `Downloading ${Math.floor(f * 100)}%` : 'Downloading…' }
  }
  if (s.state === 'PRESENT') return { color: 'green', words: 'Downloaded' }
  if (s.state === 'PARTIAL') return { color: 'amber', words: 'Part downloaded' }
  return { color: 'off', words: 'Not downloaded' }
}

/** The kinds the studio has a window for, in the order the list shows them; the others are for apps (speech, transcription). */
export const STUDIO_KINDS: readonly CatalogueSet['kind'][] = ['chat', 'vision', 'image', 'song', 'video']

/**
 * The sets the studio offers to get, in its kinds' order: those not all on disk, and those downloading. `keep` names
 * sets to list even when on disk (one this window just finished getting, so its row says Downloaded rather than vanishing).
 */
export function offered(sets: readonly CatalogueSet[], keep: ReadonlySet<string> = new Set()): CatalogueSet[] {
  return sets.filter(s => STUDIO_KINDS.includes(s.kind) && (s.state !== 'PRESENT' || s.downloading || keep.has(s.id)))
    .sort((a, b) => STUDIO_KINDS.indexOf(a.kind) - STUDIO_KINDS.indexOf(b.kind))
}

/** What the list says with no rows: that it is still reading, that it couldn't, or that everything is on disk. */
export function catalogueEmpty(sets: readonly CatalogueSet[] | null, problem: string | null): string {
  if (problem) return `Couldn't read Fornax's catalogue: ${problem}`
  return sets ? 'Every model Fornax knows by name is downloaded.' : 'Reading the catalogue…'
}

/**
 * Takes only the answer to the latest of a series of requests: one asked earlier that answers after a later one was asked
 * is dropped, as is its failure.
 */
export function latest() {
  let asked = 0
  return <T>(answer: Promise<T>, take: (value: T) => void, fail: (error: unknown) => void): void => {
    const mine = ++asked
    answer.then(v => { if (mine === asked) take(v) }, (e: unknown) => { if (mine === asked) fail(e) })
  }
}
