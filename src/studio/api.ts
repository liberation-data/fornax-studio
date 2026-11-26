/** What the studio's page asks of Fornax's backend, through the studio's own server (/api/* is passed on as it is). */

export type Kind = 'chat' | 'image' | 'song' | 'video' | 'vision'

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
  defaults: Record<string, number | string | boolean>
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
  /** structuring: an OCR model has read the image, and another model now fills the schema from its text. */
  state: 'loading' | 'loaded' | 'generating' | 'encoding' | 'structuring'
  model?: string
  sizeBytes?: number
  loadSeconds?: number
  /** With structuring: what the OCR model read, and how long it took. */
  read?: string
  readSeconds?: number
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

export interface InspectDone extends ChatDone {
  text: string
  /** The reply parsed, when a schema was asked for and the reply is whole. */
  json: unknown
  finishReason: string | null
  /** The size of the image the model saw (scaled to 1280 on its longest side). */
  width: number
  height: number
  /** What an OCR model read, when another model filled the schema from it; and how long the reading took. */
  read: string | null
  readSeconds: number | null
  filledBy: string | null
  stub: boolean
}

// ---- getting models (the backend's /api/catalogue and /api/models/pull) ----

/** How much of a set is on disk: all of it, some (an interrupted download, which the next one resumes), or none. */
export type SetState = 'PRESENT' | 'PARTIAL' | 'MISSING'

export interface CatalogueSet {
  /** Fornax's name for the set ("flux2-klein"); the studio's id for it is among its aliases ("image:flux2-klein"). */
  id: string
  aliases: string[]
  kind: 'chat' | 'vision' | 'speech' | 'transcription' | 'image' | 'song' | 'video'
  title: string
  engine: string
  /** Where the weights' licence limits their use, in words; null when it doesn't. */
  license: string | null
  /** The repo is gated: its terms must be accepted on Hugging Face, and a token given, before it downloads. */
  gated: boolean
  termsUrl: string | null
  state: SetState
  bytesOnDisk: number
  parts: { role: string; repo: string; file: string; state: SetState; bytesOnDisk: number; size: number }[]
  downloading: boolean
  progress: PullProgress | null
}

export interface PullProgress {
  id: string
  role: string
  file: string
  index: number
  count: number
  phase: 'CHECKING' | 'PRESENT' | 'WAITING' | 'DOWNLOADING' | 'DONE'
  bytesDone: number
  bytesTotal: number
  setBytesDone: number
  setBytesTotal: number
  /** 0 to 1, or -1 when the size isn't known. */
  fraction: number
  bytesPerSecond: number
  etaSeconds: number | null
}

export interface PullPlan {
  id: string
  complete: boolean
  bytesToDownload: number
  bytesTotal: number
  freeBytes: number
  license: string | null
  gated: boolean
}

/** Why a download or plan failed: a reason the Hub gave (DISK_SPACE, ACCESS_DENIED, NOT_FOUND, ...) or IO. */
export interface PullFailure {
  id: string
  message: string
  reason: string
  termsUrl?: string
}

export const loadCatalogue = (): Promise<{ models: CatalogueSet[] }> =>
  fetch('/api/catalogue', { cache: 'no-store' }).then(r => json<{ models: CatalogueSet[] }>(r))

/** What getting the set would download, and the free disk; a gated set without a token fails with its termsUrl. */
export async function planPull(id: string): Promise<PullPlan> {
  const res = await fetch('/api/models/plan', { method: 'POST', body: JSON.stringify({ id }), cache: 'no-store' })
  const body = (await res.json().catch(() => ({}))) as PullPlan & Partial<PullFailure> & { error?: string }
  if (!res.ok) throw Object.assign(new Error(body.message ?? body.error ?? `${res.status} ${res.statusText}`), { failure: body })
  return body
}

export const cancelPull = (id: string) =>
  fetch('/api/models/pull/cancel', { method: 'POST', body: JSON.stringify({ id }) }).then(r => json<{ cancelled: boolean }>(r))

/** Whether the desktop app has given the backend a Hugging Face token (the page never sees the token itself). */
export const hubStatus = (): Promise<{ tokenSet: boolean }> =>
  fetch('/api/hub', { cache: 'no-store' }).then(r => json<{ tokenSet: boolean }>(r))
