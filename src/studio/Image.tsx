'use client'

import { Button, Pane, Slider, Split, TextField, useWindowProgress } from '@liberation-data/desk/react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ImageDone, LoadStatus } from './api'
import { bytes, seconds } from './format'
import { Figures, ModelPicker, StubNotice, TextArea } from './parts'
import { postStream } from './sse'
import { useStudio } from './state'

interface Made extends ImageDone {
  prompt: string
  loadSeconds: number | null
}

/** The request the form makes, as the backend's /api/image takes it. */
export function imageRequest(model: string, form: { prompt: string; width: number; height: number; steps: number; cfg: number; seed: string }) {
  const seed = form.seed.trim() === '' ? -1 : Number(form.seed)
  return { model, prompt: form.prompt.trim(), width: form.width, height: form.height, steps: form.steps, cfg: form.cfg, seed: Number.isFinite(seed) ? seed : -1 }
}

/** A prompt in, an image out, through stable-diffusion.cpp: with the steps as they go and the time each took. */
export function ImageWindow() {
  const { chosen, refresh } = useStudio()
  const model = chosen('image')
  const [prompt, setPrompt] = useState('A neon sign that says FORNAX over a bakery at night, rain on the window')
  const [width, setWidth] = useState(768)
  const [height, setHeight] = useState(768)
  const [steps, setSteps] = useState(12)
  const [cfg, setCfg] = useState(4)
  const [seed, setSeed] = useState('')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState<LoadStatus | null>(null)
  const [progress, setProgress] = useState<{ step: number; steps: number; secondsPerStep: number } | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [made, setMade] = useState<Made[]>([])
  const [shown, setShown] = useState(0)
  const abort = useRef<AbortController | null>(null)
  useEffect(() => () => abort.current?.abort(), [])

  // A new model's own defaults, as its preset suggests them.
  const defaultsFor = useRef<string | null>(null)
  useEffect(() => {
    if (!model || defaultsFor.current === model.id) return
    defaultsFor.current = model.id
    const d = model.defaults
    if (typeof d.width === 'number') setWidth(d.width)
    if (typeof d.height === 'number') setHeight(d.height)
    if (typeof d.steps === 'number') setSteps(d.steps)
    if (typeof d.cfg === 'number') setCfg(d.cfg)
  }, [model])

  useWindowProgress(busy && progress ? { value: progress.step, max: progress.steps, label: `Step ${progress.step} of ${progress.steps}` } : null)

  const generate = useCallback(async () => {
    if (!model || busy) return
    setBusy(true)
    setProblem(null)
    setProgress(null)
    let loadSeconds: number | null = null
    const controller = new AbortController()
    abort.current = controller
    const request = imageRequest(model.id, { prompt, width, height, steps, cfg, seed })
    try {
      await postStream('/api/image', request, e => {
        const data = e.data as Record<string, unknown>
        if (e.event === 'status') {
          const s = data as unknown as LoadStatus
          setLoading(s.state === 'loading' ? s : null)
          if (s.state === 'loaded') loadSeconds = s.loadSeconds ?? null
        } else if (e.event === 'progress') {
          setProgress(data as { step: number; steps: number; secondsPerStep: number })
        } else if (e.event === 'done') {
          setMade(all => [{ ...(data as unknown as ImageDone), prompt: request.prompt, loadSeconds }, ...all])
          setShown(0)
        } else if (e.event === 'error') {
          setProblem(String(data.message ?? 'failed'))
        }
      }, controller.signal)
    } catch (e) {
      setProblem(controller.signal.aborted ? 'Stopped. The backend cancels the image at its next step.' : e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
      setLoading(null)
      abort.current = null
      refresh()
    }
  }, [model, busy, prompt, width, height, steps, cfg, seed, refresh])

  const current = made[shown]
  const form = (
    <Pane label="Image settings" padded>
      <ModelPicker kind="image" disabled={busy} />
      <TextArea label="Prompt" rows={5} value={prompt} onChange={e => setPrompt(e.target.value)} disabled={busy} />
      <div className="studio-pair">
        <TextField label="Width" type="number" step={16} min={256} max={2048} value={width} onChange={e => setWidth(Number(e.target.value))} disabled={busy} />
        <TextField label="Height" type="number" step={16} min={256} max={2048} value={height} onChange={e => setHeight(Number(e.target.value))} disabled={busy} />
      </div>
      <Slider label="Steps" min={1} max={50} value={steps} onChange={setSteps} disabled={busy} />
      <Slider label="Guidance" min={0} max={10} step={0.5} value={cfg} onChange={setCfg} disabled={busy} format={v => v.toFixed(1)} />
      <TextField label="Seed" inputMode="numeric" placeholder="Random" value={seed} onChange={e => setSeed(e.target.value)} disabled={busy}
        help={width % 16 || height % 16 ? 'Width and height are multiples of 16.' : undefined} />
      <div className="studio-actions">
        <Button intent="default" disabled={!model || busy || !prompt.trim()} onClick={() => void generate()}>
          {busy ? 'Generating…' : 'Generate'}
        </Button>
        {busy && <Button intent="quiet" onClick={() => abort.current?.abort()}>Stop</Button>}
      </div>
      {model && !model.loaded && !busy && (
        <p className="desk-text-small desk-text-muted">The first image loads {model.name} ({bytes(model.sizeBytes)}) onto the GPU first.</p>
      )}
    </Pane>
  )

  return (
    <div className="studio-window">
      <StubNotice kind="image" />
      <Split side={form} size={340} remember="fornax-studio.image" label="Resize the settings">
        <div className="studio-output">
          {problem && <p className="studio-failure">{problem}</p>}
          {busy ? (
            <div className="studio-working">
              <p>{loading ? `Loading ${model?.name} (${bytes(loading.sizeBytes)})…` : progress ? `Step ${progress.step} of ${progress.steps}` : 'Starting…'}</p>
              {progress && (
                <>
                  <div className="studio-meter-track"><div className="studio-meter-fill" style={{ width: `${(progress.step / progress.steps) * 100}%` }} /></div>
                  <p className="desk-text-small desk-text-muted">{seconds(progress.secondsPerStep)} a step</p>
                </>
              )}
            </div>
          ) : current ? (
            <figure className="studio-image">
              {/* eslint-disable-next-line @next/next/no-img-element -- made on the fly by the backend, not a static asset */}
              <img src={current.url} alt={current.prompt} width={current.width} height={current.height} />
              <figcaption>
                <Figures items={[
                  ['Generated', seconds(current.seconds)],
                  ['Per step', seconds(current.secondsPerStep)],
                  ...(current.loadSeconds != null ? [['Load', seconds(current.loadSeconds)] as const] : []),
                  ['Size', `${current.width}×${current.height}`],
                  ['Steps', String(current.steps)],
                  ['Seed', String(current.seed)],
                ]} />
                <p className="desk-text-small desk-text-muted">{current.prompt}</p>
                {window.studioNative && <Button size="small" intent="quiet" onClick={() => window.studioNative?.showFile(current.file)}>Show in Folder</Button>}
              </figcaption>
            </figure>
          ) : (
            <div className="studio-hint">
              <h2>Image</h2>
              <p>stable-diffusion.cpp, in the JVM. The weights load once and stay loaded for the next image.</p>
            </div>
          )}
          {made.length > 1 && (
            <div className="studio-strip" role="list" aria-label="Images made">
              {made.map((m, i) => (
                <button key={m.url} role="listitem" className="studio-thumb" aria-current={i === shown || undefined} onClick={() => setShown(i)} title={m.prompt}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={m.url} alt="" />
                </button>
              ))}
            </div>
          )}
        </div>
      </Split>
    </div>
  )
}
