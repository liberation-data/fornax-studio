/** What the studio's page asks of Kiln's backend, through the studio's own server (/api/* is passed on as it is). */

export type Kind = 'chat' | 'image' | 'song' | 'video'

export interface Part {
  role: string
  repo: string
  file: string
  present: boolean
}

export interface Model {
  id: string
  kind: Kind
  name: string
  engine: string
  available: boolean
  sizeBytes: number
  parts: Part[]
  defaults: Record<string, number | string>
  loaded: boolean
  inUse: boolean
  loading: boolean
  lastUsed: string | null
  loadSeconds: number | null
  /** Answered by a stub in this backend: nothing is loaded and nothing real is made. */
  stub: boolean
  /** Where the weights' license limits what may be done with what they make (YuE2's CC BY-NC 4.0), in words. */
  license: string | null
}

export interface GpuMemory {
  card: string
  vramUsed: number | null
  vramTotal: number | null
  gttUsed: number | null
  gttTotal: number | null
}

export interface Status {
  cacheRoot: string
  budgetBytes: number
  loadedBytes: number
  gpu: GpuMemory[]
  stubs: Kind[]
  models: Model[]
}

async function json<T>(res: Response): Promise<T> {
  const body = (await res.json().catch(() => ({}))) as T & { error?: string }
  if (!res.ok) throw new Error(body.error ?? `${res.status} ${res.statusText}`)
  return body
}

export const loadStatus = (): Promise<Status> => fetch('/api/models', { cache: 'no-store' }).then(r => json<Status>(r))

export const loadModel = (id: string) =>
  fetch('/api/models/load', { method: 'POST', body: JSON.stringify({ id }) }).then(r => json<{ loadSeconds: number | null }>(r))

export const unloadModel = (id: string) =>
  fetch('/api/models/unload', { method: 'POST', body: JSON.stringify({ id }) }).then(r => json<{ unloaded: boolean }>(r))

// ---- what the streams say ----

export interface LoadStatus {
  state: 'loading' | 'loaded' | 'generating' | 'encoding'
  model?: string
  sizeBytes?: number
  loadSeconds?: number
}

export interface ChatDone {
  seconds: number
  firstTokenSeconds: number
  promptTokens: number
  generatedTokens: number
  tokensPerSecond: number
  text?: string
}

export interface ToolCall {
  id?: string
  type?: string
  function: { name: string; arguments: string | Record<string, unknown> }
}

export interface AssistantMessage {
  role: 'assistant'
  content: string | null
  reasoning_content?: string
  tool_calls?: ToolCall[]
}

export interface ToolResult {
  id?: string
  name: string
  arguments: Record<string, unknown>
  result: string
}

export interface ImageDone {
  url: string
  file: string
  width: number
  height: number
  steps: number
  cfg: number
  seed: number
  seconds: number
  secondsPerStep: number
  stub: boolean
}

export interface SongDone {
  url: string
  file: string
  seconds: number
  audioSeconds: number
  realtime: number
  request: Record<string, unknown>
  /** The ABC score YuE2 composed before it sang (null for ACE-Step). */
  score: string | null
  license: string | null
  stub: boolean
}

/** A sampling step of a video: of the draft (stage 1) or the refine (stage 2) in the two-stage recipe. */
export interface VideoProgress {
  step: number
  steps: number
  secondsPerStep: number
  stage: number
  stages: number
}

export interface VideoDone {
  url: string
  file: string
  width: number
  height: number
  frames: number
  fps: number
  videoSeconds: number
  audio: boolean
  steps: number
  cfg: number
  seed: number
  twoStage: boolean
  seconds: number
  stub: boolean
}
