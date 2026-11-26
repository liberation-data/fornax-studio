'use client'

import { Button, CodeBlock, Pane, Slider, Split, TextField } from '@liberation-data/desk/react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { LoadStatus, SongDone } from './api'
import { bytes, seconds } from './format'
import { Figures, LicenseNote, ModelPicker, StubNotice, TextArea } from './parts'
import { postStream } from './sse'
import { useStudio } from './state'

interface Made extends SongDone {
  caption: string
  loadSeconds: number | null
  modelName: string
}

/** YuE2 takes a style and lyrics only: its style says the tempo and key, in words. */
export const isYue2 = (engine: string | undefined) => engine === 'yue2.cpp'

const LYRICS = `[Verse 1]
Rusty rolled in on a Tuesday night
Chrome on his knuckles and his eyes burned bright

[Chorus]
Oh, he's a machine with a honky-tonk heart
Runs on diesel and a broken old part`

/**
 * The request the form makes, as the backend's /api/song takes it (it writes the engine's own from it): for YuE2, the
 * style, lyrics, length and seed alone.
 */
export function songRequest(model: string, form: { caption: string; lyrics: string; duration: number; bpm: number; keyscale: string; steps: number; seed: string }, engine?: string) {
  const seed = form.seed.trim() === '' ? -1 : Number(form.seed)
  const common = { model, caption: form.caption.trim(), lyrics: form.lyrics, duration: form.duration, seed: Number.isFinite(seed) ? seed : -1 }
  if (isYue2(engine)) return common
  return { ...common, bpm: form.bpm, keyscale: form.keyscale.trim() || 'C major', steps: form.steps }
}

/** A description and lyrics in, a song out, through acestep.cpp or yue2.cpp: played here, with how long it took to make. */
export function Song() {
  const { chosen, refresh } = useStudio()
  const model = chosen('song')
  const yue2 = isYue2(model?.engine)
  const [caption, setCaption] = useState('modern country rock, male baritone vocal with a southern twang, telecaster, pedal steel, driving drums, big singalong chorus')
  const [lyrics, setLyrics] = useState(LYRICS)
  const [duration, setDuration] = useState(30)
  const [bpm, setBpm] = useState(96)
  const [keyscale, setKeyscale] = useState('G major')
  const [steps, setSteps] = useState(8)
  const [seed, setSeed] = useState('')
  const [busy, setBusy] = useState(false)
  const [phase, setPhase] = useState<string | null>(null)
  const [started, setStarted] = useState(0)
  const [now, setNow] = useState(0)
  const [problem, setProblem] = useState<string | null>(null)
  const [made, setMade] = useState<Made[]>([])
  const abort = useRef<AbortController | null>(null)
  useEffect(() => () => abort.current?.abort(), [])
  // ACE-Step says nothing until the song is done, so the wait is counted here.
  useEffect(() => {
    if (!busy) return
    const timer = window.setInterval(() => setNow(performance.now()), 250)
    return () => window.clearInterval(timer)
  }, [busy])


  const generate = useCallback(async () => {
    if (!model || busy) return
    setBusy(true)
    setProblem(null)
    setPhase('Starting…')
    setStarted(performance.now())
    setNow(performance.now())
    let loadSeconds: number | null = null
    const controller = new AbortController()
    abort.current = controller
    const request = songRequest(model.id, { caption, lyrics, duration, bpm, keyscale, steps, seed }, model.engine)
    try {
      await postStream('/api/song', request, e => {
        const data = e.data as Record<string, unknown>
        if (e.event === 'status') {
          const s = data as unknown as LoadStatus
          if (s.state === 'loading') setPhase(`Loading ${model.name} (${bytes(s.sizeBytes)})…`)
          if (s.state === 'loaded') loadSeconds = s.loadSeconds ?? null
          if (s.state === 'generating') setPhase('Writing the song…')
        } else if (e.event === 'done') {
          setMade(all => [{ ...(data as unknown as SongDone), caption: request.caption, loadSeconds, modelName: model.name }, ...all])
        } else if (e.event === 'error') {
          setProblem(String(data.message ?? 'failed'))
        }
      }, controller.signal)
    } catch (e) {
      setProblem(controller.signal.aborted ? 'Stopped waiting. The backend finishes the song anyway (the song engines report no progress to stop at).' : e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
      setPhase(null)
      abort.current = null
      refresh()
    }
  }, [model, busy, caption, lyrics, duration, bpm, keyscale, steps, seed, refresh])

  const form = (
    <Pane label="Song settings" padded>
      <ModelPicker kind="song" disabled={busy} />
      <LicenseNote model={model} />
      <TextArea label="Style" rows={3} value={caption} onChange={e => setCaption(e.target.value)} disabled={busy}
        help={yue2 ? 'Genre, voice, instruments, mood, and the tempo and key in words.' : 'Genre, voice, instruments, mood.'} />
      <TextArea label="Lyrics" rows={9} value={lyrics} onChange={e => setLyrics(e.target.value)} disabled={busy} help="[Verse], [Chorus] and [Bridge] mark the sections." />
      <Slider label="Length" min={10} max={240} step={5} value={duration} onChange={setDuration} disabled={busy} format={v => `${v} s`} />
      {yue2 ? (
        <TextField label="Seed" inputMode="numeric" placeholder="Random" value={seed} onChange={e => setSeed(e.target.value)} disabled={busy} />
      ) : (
        <>
          <div className="studio-pair">
            <TextField label="BPM" type="number" min={40} max={220} value={bpm} onChange={e => setBpm(Number(e.target.value))} disabled={busy} />
            <TextField label="Key" value={keyscale} onChange={e => setKeyscale(e.target.value)} disabled={busy} />
          </div>
          <div className="studio-pair">
            <TextField label="Steps" type="number" min={1} max={100} value={steps} onChange={e => setSteps(Number(e.target.value))} disabled={busy} />
            <TextField label="Seed" inputMode="numeric" placeholder="Random" value={seed} onChange={e => setSeed(e.target.value)} disabled={busy} />
          </div>
        </>
      )}
      <div className="studio-actions">
        <Button intent="default" disabled={!model || busy || !caption.trim()} onClick={() => void generate()}>{busy ? 'Generating…' : 'Generate'}</Button>
        {busy && <Button intent="quiet" onClick={() => abort.current?.abort()}>Stop waiting</Button>}
      </div>
      {model && !model.loaded && !busy && (
        <p className="desk-text-small desk-text-muted">The first song loads {model.name} ({bytes(model.sizeBytes)}) onto the GPU first.</p>
      )}
    </Pane>
  )

  return (
    <div className="studio-window">
      <StubNotice kind="song" />
      <Split side={form} size={360} remember="fornax-studio.song" label="Resize the settings">
        <Pane label="Songs made" padded>
          {problem && <p className="studio-failure">{problem}</p>}
          {busy && (
            <div className="studio-working">
              <p>{phase}</p>
              <p className="desk-text-small desk-text-muted">{seconds((now - started) / 1000)} so far</p>
            </div>
          )}
          {made.length === 0 && !busy && (
            <div className="studio-hint">
              <h2>Song</h2>
              <p>ACE-Step 1.5 through acestep.cpp, or YuE2 through yue2.cpp, in the JVM: a style and lyrics in, 48 kHz stereo out.</p>
            </div>
          )}
          {made.map((m, i) => (
            <article key={m.url} className="studio-song" aria-label={`Song ${made.length - i}`}>
              <audio controls src={m.url} preload="metadata" />
              <Figures items={[
                ['Generated', seconds(m.seconds)],
                ['Audio', seconds(m.audioSeconds)],
                ['Speed', `${m.realtime.toFixed(1)}× real time`],
                ...(m.loadSeconds != null ? [['Load', seconds(m.loadSeconds)] as const] : []),
              ]} />
              <p className="desk-text-small desk-text-muted">{m.modelName} · {m.caption}</p>
              {m.license && <p className="desk-text-small desk-text-muted">Weights: {m.license}.</p>}
              <details>
                <summary className="desk-text-small">Request as {m.modelName} resolved it</summary>
                <CodeBlock language="json" label={`${m.modelName} request`} code={JSON.stringify(m.request, null, 2)} />
              </details>
              {m.score && (
                <details>
                  <summary className="desk-text-small">Score YuE2 wrote first (ABC)</summary>
                  <CodeBlock language="text" label="ABC score" code={m.score} />
                </details>
              )}
              {window.studioNative && <Button size="small" intent="quiet" onClick={() => window.studioNative?.showFile(m.file)}>Show in Folder</Button>}
            </article>
          ))}
        </Pane>
      </Split>
    </div>
  )
}
