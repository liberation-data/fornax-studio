'use client'

import { Button, Checkbox, Pane, Slider, Split, TextField, useWindowProgress } from '@liberation-data/desk/react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { LoadStatus, VideoDone, VideoProgress } from './api'
import { bytes, seconds } from './format'
import { Figures, ModelPicker, StubNotice, TextArea } from './parts'
import { postStream } from './sse'
import { useStudio } from './state'

interface Made extends VideoDone {
  prompt: string
  loadSeconds: number | null
}

interface VideoForm {
  prompt: string
  /** The first frame, as a data: URL, or null to start from the prompt alone. */
  image: string | null
  width: number
  height: number
  frames: number
  fps: number
  steps: number
  cfg: number
  seed: string
  twoStage: boolean
  audio: boolean
}

/**
 * LTX takes 8n + 1 frames. There is no upper limit: how long a clip can be depends on memory and the backend, not on
 * the model (Endless Country's clips run to 313 frames).
 */
export const framesAllowed = (n: number) => Number.isInteger(n) && n >= 9 && n % 8 === 1

/**
 * Past this many frames, a full-size refine can run a single GPU dispatch longer than the amdgpu driver allows on
 * Vulkan (the device is lost). ROCm and CUDA builds don't have that limit.
 */
export const LONG_CLIP_FRAMES = 121
export const longClip = (form: { frames: number; width: number; height: number; twoStage: boolean }) => {
  const size = clipSize(form)
  return form.frames > LONG_CLIP_FRAMES && size.width * size.height >= 1024 * 576
}

/** The clip's size: two-stage refines the draft at twice its size. */
export const clipSize = (form: { width: number; height: number; twoStage: boolean }) =>
  form.twoStage ? { width: form.width * 2, height: form.height * 2 } : { width: form.width, height: form.height }

/**
 * The request the form makes, as the backend's /api/video takes it. Two-stage runs VideoClip's recipe, whose draft and
 * refine have their own sigmas, so the steps are sent only for one pass.
 */
export function videoRequest(model: string, form: VideoForm) {
  const seed = form.seed.trim() === '' ? -1 : Number(form.seed)
  return {
    model, prompt: form.prompt.trim(), width: form.width, height: form.height, frames: form.frames, fps: form.fps, cfg: form.cfg,
    seed: Number.isFinite(seed) ? seed : -1, twoStage: form.twoStage, audio: form.audio,
    ...(form.twoStage ? {} : { steps: form.steps }),
    ...(form.image ? { image: form.image } : {}),
  }
}

/** Where a render is, in words: the stage (of two-stage) and its step. */
export function videoPhase(p: VideoProgress | null, state: LoadStatus['state'] | null): string {
  if (state === 'encoding') return 'Making the .mp4…'
  if (!p) return state === 'generating' ? 'Reading the prompt…' : 'Starting…'
  const step = `step ${p.step} of ${p.steps}`
  if (p.stages < 2) return `Step ${p.step} of ${p.steps}`
  return p.stage === 1 ? `Draft: ${step}` : `Refine at twice the size: ${step}`
}

/** A prompt (and a first frame) in, a clip with sound out, through LTX-2.5 in stable-diffusion.cpp. */
export function VideoWindow() {
  const { chosen, refresh } = useStudio()
  const model = chosen('video')
  const [prompt, setPrompt] = useState('A slow push in on a potter at a wheel, clay spinning, warm light from a kiln behind, the hum of the wheel')
  const [image, setImage] = useState<{ name: string; url: string } | null>(null)
  const [width, setWidth] = useState(672)
  const [height, setHeight] = useState(448)
  const [frames, setFrames] = useState(49)
  const [fps, setFps] = useState(24)
  const [steps, setSteps] = useState(8)
  const [cfg, setCfg] = useState(1)
  const [seed, setSeed] = useState('')
  const [twoStage, setTwoStage] = useState(true)
  const [audio, setAudio] = useState(true)
  const [busy, setBusy] = useState(false)
  const [state, setState] = useState<LoadStatus | null>(null)
  const [progress, setProgress] = useState<VideoProgress | null>(null)
  const [started, setStarted] = useState(0)
  const [now, setNow] = useState(0)
  const [problem, setProblem] = useState<string | null>(null)
  const [made, setMade] = useState<Made[]>([])
  const [shown, setShown] = useState(0)
  const abort = useRef<AbortController | null>(null)
  const picker = useRef<HTMLInputElement | null>(null)
  useEffect(() => () => abort.current?.abort(), [])
  // A render takes minutes: the time so far is counted here.
  useEffect(() => {
    if (!busy) return
    const timer = window.setInterval(() => setNow(performance.now()), 500)
    return () => window.clearInterval(timer)
  }, [busy])

  // A new model's own defaults, as its preset suggests them.
  const defaultsFor = useRef<string | null>(null)
  useEffect(() => {
    if (!model || defaultsFor.current === model.id) return
    defaultsFor.current = model.id
    const d = model.defaults
    if (typeof d.width === 'number') setWidth(d.width)
    if (typeof d.height === 'number') setHeight(d.height)
    if (typeof d.frames === 'number') setFrames(d.frames)
    if (typeof d.fps === 'number') setFps(d.fps)
    if (typeof d.steps === 'number') setSteps(d.steps)
    if (typeof d.cfg === 'number') setCfg(d.cfg)
  }, [model])

  useWindowProgress(busy && progress ? { value: progress.step, max: progress.steps, label: videoPhase(progress, state?.state ?? null) } : null)

  const choose = (file: File | undefined) => {
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => setImage({ name: file.name, url: String(reader.result) })
    reader.readAsDataURL(file)
  }

  const generate = useCallback(async () => {
    if (!model || busy) return
    setBusy(true)
    setProblem(null)
    setProgress(null)
    setState(null)
    setStarted(performance.now())
    setNow(performance.now())
    let loadSeconds: number | null = null
    const controller = new AbortController()
    abort.current = controller
    const request = videoRequest(model.id, { prompt, image: image?.url ?? null, width, height, frames, fps, steps, cfg, seed, twoStage, audio })
    try {
      await postStream('/api/video', request, e => {
        const data = e.data as Record<string, unknown>
        if (e.event === 'status') {
          const s = data as unknown as LoadStatus
          setState(s)
          if (s.state === 'loaded') loadSeconds = s.loadSeconds ?? null
        } else if (e.event === 'progress') {
          setProgress(data as unknown as VideoProgress)
        } else if (e.event === 'done') {
          setMade(all => [{ ...(data as unknown as VideoDone), prompt: request.prompt, loadSeconds }, ...all])
          setShown(0)
        } else if (e.event === 'error') {
          setProblem(String(data.message ?? 'failed'))
        }
      }, controller.signal)
    } catch (e) {
      setProblem(controller.signal.aborted ? 'Stopped waiting. The backend finishes the clip anyway (stable-diffusion.cpp has no way to stop a render).' : e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
      setState(null)
      abort.current = null
      refresh()
    }
  }, [model, busy, prompt, image, width, height, frames, fps, steps, cfg, seed, twoStage, audio, refresh])

  const size = clipSize({ width, height, twoStage })
  const sizeOk = width % 16 === 0 && height % 16 === 0 && width >= 128 && height >= 128 && width <= 1536 && height <= 1536
  const current = made[shown]
  const form = (
    <Pane label="Video settings" padded>
      <ModelPicker kind="video" disabled={busy} />
      <TextArea label="Prompt" rows={5} value={prompt} onChange={e => setPrompt(e.target.value)} disabled={busy} help="What is seen, how the camera moves, and what is heard." />
      <div className="desk-field">
        <span className="desk-label">First frame</span>
        <div className="studio-actions">
          <Button size="small" disabled={busy} onClick={() => picker.current?.click()}>{image ? 'Change…' : 'Choose…'}</Button>
          {image && <Button size="small" intent="quiet" disabled={busy} onClick={() => setImage(null)}>Remove</Button>}
        </div>
        <input ref={picker} type="file" accept="image/png,image/jpeg" hidden onChange={e => { choose(e.target.files?.[0]); e.target.value = '' }} />
        {image
          // eslint-disable-next-line @next/next/no-img-element -- the user's own file, read in the page
          ? <img className="studio-keyframe" src={image.url} alt={`First frame: ${image.name}`} />
          : <span className="desk-help">Optional: a PNG or JPEG the clip starts from.</span>}
      </div>
      <div className="studio-pair">
        <TextField label="Width" type="number" step={16} min={128} max={1536} value={width} onChange={e => setWidth(Number(e.target.value))} disabled={busy} />
        <TextField label="Height" type="number" step={16} min={128} max={1536} value={height} onChange={e => setHeight(Number(e.target.value))} disabled={busy} />
      </div>
      <div className="studio-pair">
        <TextField label="Frames" type="number" step={8} min={9} value={frames} onChange={e => setFrames(Number(e.target.value))} disabled={busy}
          help={!framesAllowed(frames) ? 'Frames are 8n + 1: 49, 97, 121…'
            : `${seconds(frames / Math.max(1, fps))} at ${fps} fps` + (longClip({ frames, width, height, twoStage })
              ? '. A clip this long at this size can lose the GPU on a Vulkan build; on AMD, a ROCm build handles it, and faster.'
              : '')} />
        <TextField label="FPS" type="number" min={1} max={60} value={fps} onChange={e => setFps(Number(e.target.value))} disabled={busy} />
      </div>
      <Checkbox checked={twoStage} onChange={setTwoStage} disabled={busy} label="Two-stage"
        description={`A draft at ${width}×${height}, then the x2 upscaler and a refine: the clip is ${size.width}×${size.height}.`} />
      <Checkbox checked={audio} onChange={setAudio} disabled={busy} label="Sound"
        description="LTX makes the soundtrack with the picture. Without it, the model loads without its audio VAE." />
      {!twoStage && <Slider label="Steps" min={1} max={50} value={steps} onChange={setSteps} disabled={busy} />}
      <Slider label="Guidance" min={0} max={10} step={0.5} value={cfg} onChange={setCfg} disabled={busy} format={v => v.toFixed(1)} />
      <TextField label="Seed" inputMode="numeric" placeholder="Random" value={seed} onChange={e => setSeed(e.target.value)} disabled={busy}
        help={sizeOk ? undefined : 'Width and height are multiples of 16, from 128 to 1536.'} />
      <div className="studio-actions">
        <Button intent="default" disabled={!model || busy || !prompt.trim() || !sizeOk || !framesAllowed(frames)} onClick={() => void generate()}>
          {busy ? 'Generating…' : 'Generate'}
        </Button>
        {busy && <Button intent="quiet" onClick={() => abort.current?.abort()}>Stop waiting</Button>}
      </div>
      {model && !model.loaded && !busy && (
        <p className="desk-text-small desk-text-muted">The first clip loads {model.name} ({bytes(model.sizeBytes)}) onto the GPU first. A clip takes minutes.</p>
      )}
    </Pane>
  )

  return (
    <div className="studio-window">
      <StubNotice kind="video" />
      <Split side={form} size={360} remember="kiln-studio.video" label="Resize the settings">
        <div className="studio-output">
          {problem && <p className="studio-failure">{problem}</p>}
          {busy ? (
            <div className="studio-working">
              <p>{state?.state === 'loading' ? `Loading ${model?.name} (${bytes(state.sizeBytes)})…` : videoPhase(progress, state?.state ?? null)}</p>
              {progress && state?.state !== 'encoding' && (
                <>
                  <div className="studio-meter-track"><div className="studio-meter-fill" style={{ width: `${(progress.step / progress.steps) * 100}%` }} /></div>
                  <p className="desk-text-small desk-text-muted">{seconds(progress.secondsPerStep)} a step</p>
                </>
              )}
              <p className="desk-text-small desk-text-muted">{seconds((now - started) / 1000)} so far</p>
            </div>
          ) : current ? (
            <figure className="studio-image">
              <video key={current.url} className="studio-video" controls src={current.url} preload="metadata" width={current.width} height={current.height} />
              <figcaption>
                <Figures items={[
                  ['Generated', seconds(current.seconds)],
                  ...(current.loadSeconds != null ? [['Load', seconds(current.loadSeconds)] as const] : []),
                  ['Clip', `${seconds(current.videoSeconds)}${current.audio ? ', with sound' : ''}`],
                  ['Size', `${current.width}×${current.height}`],
                  ['Frames', `${current.frames} at ${current.fps} fps`],
                  ['Seed', String(current.seed)],
                ]} />
                <p className="desk-text-small desk-text-muted">{current.prompt}</p>
                {window.studioNative && <Button size="small" intent="quiet" onClick={() => window.studioNative?.showFile(current.file)}>Show in Folder</Button>}
              </figcaption>
            </figure>
          ) : (
            <div className="studio-hint">
              <h2>Video</h2>
              <p>LTX-2.5 through stable-diffusion.cpp, in the JVM: a prompt, and a first frame if you like, in; a clip with its own soundtrack out.</p>
            </div>
          )}
          {made.length > 1 && (
            <div className="studio-strip" role="list" aria-label="Clips made">
              {made.map((m, i) => (
                <button key={m.url} role="listitem" className="studio-thumb" aria-current={i === shown || undefined} onClick={() => setShown(i)} title={m.prompt}>
                  <video src={m.url} preload="metadata" muted />
                </button>
              ))}
            </div>
          )}
        </div>
      </Split>
    </div>
  )
}
