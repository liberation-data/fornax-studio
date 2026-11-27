/** Sizes and times as the studio shows them. */

export function bytes(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—'
  if (n < 1024) return `${n} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let v = n / 1024
  let u = 0
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024
    u++
  }
  return `${v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2)} ${units[u]}`
}

export function seconds(s: number | null | undefined): string {
  if (s == null || !Number.isFinite(s)) return '—'
  if (s < 1) return `${Math.round(s * 1000)} ms`
  if (s < 60) return `${s.toFixed(s < 10 ? 2 : 1)} s`
  const m = Math.floor(s / 60)
  return `${m} min ${Math.round(s - m * 60)} s`
}

/** A model's files in words: "repo · file" for one, or how many and their roles: "3 files: diffusion_model, vae, llm". */
export function partsWords(parts: readonly { role: string; repo: string; file: string }[]): string {
  return parts.length === 1 ? `${parts[0]?.repo} · ${parts[0]?.file}` : `${parts.length} files: ${parts.map(p => p.role).join(', ')}`
}

export function rate(perSecond: number | null | undefined, unit = 'tok/s'): string {
  if (perSecond == null || !Number.isFinite(perSecond) || perSecond <= 0) return '—'
  return `${perSecond >= 100 ? perSecond.toFixed(0) : perSecond.toFixed(1)} ${unit}`
}

/**
 * A reply split into its reasoning (a <think> block, as Qwen3 writes) and its answer. While the block is still open the
 * whole of it so far is reasoning.
 */
export function splitThinking(text: string): { thinking: string | null; answer: string; thinkingOpen: boolean } {
  const open = text.indexOf('<think>')
  if (open < 0) return { thinking: null, answer: text, thinkingOpen: false }
  const close = text.indexOf('</think>', open)
  if (close < 0) return { thinking: text.slice(open + 7).trim(), answer: text.slice(0, open).trim(), thinkingOpen: true }
  return {
    thinking: text.slice(open + 7, close).trim(),
    answer: (text.slice(0, open) + text.slice(close + 8)).trim(),
    thinkingOpen: false,
  }
}
