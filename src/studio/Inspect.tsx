'use client'

import { Button, CodeBlock, Disclosure, Pane, SegmentedControl, Split, Table, Tabs } from '@liberation-data/desk/react'
import type { Column } from '@liberation-data/desk/react'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { InspectDone, LoadStatus } from './api'
import { bytes, rate, seconds } from './format'
import { PRESETS, SAMPLES, cell, contain, fieldsOf, findBoxes, humanize, inspectPhase, inspectRequest, parseSchema, readOf } from './inspect'
import type { Box, Preset, PresetId, Read } from './inspect'
import { Figures, LicenseNote, ModelPicker, StubNotice, TextArea } from './parts'
import { postStream } from './sse'
import { useStudio } from './state'

/** The image being inspected: a data: URL, and whether it is one of the window's samples (a preset may replace it). */
interface Picture {
  name: string
  url: string
  sample: boolean
}

const readAsDataUrl = (blob: Blob) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader()
  reader.onload = () => resolve(String(reader.result))
  reader.onerror = () => reject(reader.error ?? new Error('could not read the image'))
  reader.readAsDataURL(blob)
})

/** The size that fits an image of this shape into the box, as `object-fit: contain` would draw it. */
function useFitted(ratio: number | null) {
  const box = useRef<HTMLDivElement | null>(null)
  const [size, setSize] = useState<{ width: number; height: number } | null>(null)
  useLayoutEffect(() => {
    const el = box.current
    if (!el || !ratio) return
    const measure = () => {
      // The content box: clientWidth and clientHeight count the padding, and a frame sized past it is squeezed by its
      // max-width or max-height out of the image's shape, so the boxes drawn over it would miss.
      const css = getComputedStyle(el)
      const fitted = contain(el.clientWidth - parseFloat(css.paddingLeft) - parseFloat(css.paddingRight),
        el.clientHeight - parseFloat(css.paddingTop) - parseFloat(css.paddingBottom), ratio)
      if (fitted) setSize(fitted)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [ratio])
  return { box, size }
}

/** The picture, with the model's boxes drawn over it. */
function Stage({ picture, boxes }: { picture: Picture; boxes: readonly Box[] }) {
  const [ratio, setRatio] = useState<number | null>(null)
  const { box, size } = useFitted(ratio)
  return (
    <div className="studio-inspect-stage" ref={box}>
      <div className="studio-inspect-frame" style={size ? { width: size.width, height: size.height } : undefined}>
        {/* eslint-disable-next-line @next/next/no-img-element -- the user's own image, read in the page */}
        <img src={picture.url} alt={picture.name} onLoad={e => setRatio(e.currentTarget.naturalWidth / e.currentTarget.naturalHeight)} />
        {boxes.map((b, i) => (
          <div key={i} className="studio-inspect-box" style={{ left: `${b.x * 100}%`, top: `${b.y * 100}%`, width: `${b.w * 100}%`, height: `${b.h * 100}%` }}>
            {b.label && <span>{b.label}</span>}
          </div>
        ))}
      </div>
    </div>
  )
}

/** **Bold** and bulleted lines, as a model writes them in a free-text answer; anything else in it stays text. */
export function Prose({ text }: { text: string }) {
  const inline = (line: string) => line.split(/\*\*(.+?)\*\*/g).map((part, i) => (i % 2 ? <strong key={i}>{part}</strong> : part))
  return (
    <div className="studio-inspect-prose">
      {text.split('\n').map((line, i) => {
        const bullet = /^\s*[*-]\s+(.*)$/.exec(line)
        if (bullet) return <p key={i} className="studio-inspect-bullet">{inline(bullet[1] ?? '')}</p>
        return line.trim() ? <p key={i}>{inline(line)}</p> : <div key={i} className="studio-inspect-gap" />
      })}
    </div>
  )
}

/** A reply held to a schema, as tables: its single values as fields, and each list as a table of its own. */
function FieldTables({ json }: { json: unknown }) {
  const { fields, tables } = useMemo(() => fieldsOf(json), [json])
  const fieldColumns = useMemo<Column<(typeof fields)[number]>[]>(() => [
    { key: 'label', header: 'Field', width: '40%' },
    { key: 'value', header: 'Value', render: f => <span className="studio-inspect-value">{f.value}</span> },
  ], [])
  return (
    <div className="studio-inspect-tables">
      {fields.length > 0 && <Table label="Fields" rows={fields} rowId={f => f.key} columns={fieldColumns} />}
      {tables.map(t => (
        <section key={t.key} className="studio-inspect-table">
          <h3>{t.label} <span className="desk-text-muted">({t.rows.length})</span></h3>
          <Table
            label={t.label}
            rows={t.rows.map((r, i) => ({ ...r, __row: String(i) }))}
            rowId={r => String(r.__row)}
            empty={<span className="desk-text-muted">None found.</span>}
            columns={t.columns.map(c => {
              const numeric = t.rows.every(r => typeof r[c] === 'number')
              return { key: c, header: humanize(c), numeric, align: numeric ? 'end' : 'start', render: (r: Record<string, unknown>) => cell(c, r[c]) }
            })}
          />
        </section>
      ))}
    </div>
  )
}

/** An image and a question in; a vision model's answer out, streamed, as free text or held to a JSON schema. */
export function InspectWindow() {
  const { chosen, choose, status, refresh } = useStudio()
  const model = chosen('vision')
  const first = PRESETS[0] as Preset
  const [preset, setPreset] = useState<PresetId>(first.id)
  const [prompt, setPrompt] = useState(first.prompt)
  const [schemaText, setSchemaText] = useState(first.schema)
  const [schemaOpen, setSchemaOpen] = useState(false)
  const [picture, setPicture] = useState<Picture | null>(null)
  const [dragging, setDragging] = useState(false)
  const [busy, setBusy] = useState(false)
  const [state, setState] = useState<LoadStatus | null>(null)
  const [text, setText] = useState('')
  /** What an OCR model read, and which model read it; and the model now filling the schema from it. */
  const [read, setRead] = useState<Read | null>(null)
  const [filling, setFilling] = useState<string | null>(null)
  const [done, setDone] = useState<InspectDone | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [view, setView] = useState<'fields' | 'json'>('fields')
  const [live, setLive] = useState<{ tokens: number; first: number | null; now: number }>({ tokens: 0, first: null, now: 0 })
  const abort = useRef<AbortController | null>(null)
  const picker = useRef<HTMLInputElement | null>(null)
  useEffect(() => () => abort.current?.abort(), [])

  const ocr = model?.defaults.ocr === true
  const { schema, problem: schemaProblem } = parseSchema(schemaText)
  const current = PRESETS.find(p => p.id === preset)

  const show = useCallback((p: Picture) => {
    setPicture(p)
    setDone(null)
    setText('')
    setRead(null)
    setProblem(null)
  }, [])

  const takeFile = useCallback(async (file: File | undefined) => {
    if (!file) return
    if (!/^image\/(png|jpeg)$/.test(file.type)) {
      setProblem('A PNG or JPEG, please.')
      return
    }
    show({ name: file.name, url: await readAsDataUrl(file), sample: false })
  }, [show])

  const takeSample = useCallback(async (url: string) => {
    const label = SAMPLES.find(s => s.url === url)?.label ?? url
    try {
      const blob = await fetch(url).then(r => {
        if (!r.ok) throw new Error(`${r.status} ${r.statusText}`)
        return r.blob()
      })
      show({ name: label, url: await readAsDataUrl(blob), sample: true })
    } catch (e) {
      setProblem(`Couldn’t load the sample: ${e instanceof Error ? e.message : String(e)}`)
    }
  }, [show])

  // A preset fills the prompt and schema, picks the model it suits when it is in the cache, and shows its sample
  // unless an image of your own is there.
  const applyPreset = useCallback((id: PresetId) => {
    const p = PRESETS.find(x => x.id === id)
    if (!p) return
    setPreset(id)
    setPrompt(p.prompt)
    setSchemaText(p.schema)
    const suited = status?.models.find(m => m.id === p.model && m.available)
    if (suited) choose('vision', suited.id)
    if (!picture || picture.sample) void takeSample(p.sample)
  }, [status, choose, picture, takeSample])

  const inspect = useCallback(async () => {
    if (!model || !picture || busy) return
    setBusy(true)
    setProblem(null)
    setDone(null)
    setText('')
    setRead(null)
    setFilling(null)
    setState(null)
    setView('fields')
    setLive({ tokens: 0, first: null, now: performance.now() })
    const controller = new AbortController()
    abort.current = controller
    try {
      await postStream('/api/inspect', inspectRequest(model.id, { image: picture.url, prompt, schema }), e => {
        const data = e.data as Record<string, unknown>
        if (e.event === 'status') {
          const s = data as unknown as LoadStatus
          setState(s)
          if (s.state === 'loaded') refresh()
          if (s.state === 'structuring') {
            // The OCR model has read the page; another fills the schema from its text, and streams afresh.
            setRead(readOf({ ...s, read: s.read ?? '' }, model.name))
            setFilling(status?.models.find(m => m.id === s.model)?.name ?? 'another model')
            setText('')
            setLive({ tokens: 0, first: null, now: performance.now() })
          }
        } else if (e.event === 'token') {
          const piece = String(data.text ?? '')
          setText(t => t + piece)
          const now = performance.now()
          setLive(l => ({ tokens: l.tokens + 1, first: l.first ?? now, now }))
        } else if (e.event === 'done') {
          const d = data as unknown as InspectDone
          setDone(d)
          setText(d.text)
          if (d.read != null) setRead(readOf(d, model.name))
        } else if (e.event === 'error') {
          setProblem(String(data.message ?? 'failed'))
        }
      }, controller.signal)
    } catch (e) {
      setProblem(controller.signal.aborted ? 'Stopped.' : e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
      setState(null)
      setFilling(null)
      abort.current = null
      refresh()
    }
  }, [model, picture, busy, prompt, schema, refresh, status])

  const boxes = useMemo(() => (done?.json != null ? findBoxes(done.json, done.width, done.height) : []), [done])
  const liveRate = live.first != null && live.now > live.first ? ((live.tokens - 1) * 1000) / (live.now - live.first) : null
  const working = inspectPhase(state, id => status?.models.find(m => m.id === id)?.name, filling, liveRate)
  const reviewNote = current?.note && preset === 'review'

  const form = (
    <Pane label="Inspect settings" padded>
      <ModelPicker kind="vision" disabled={busy} />
      <LicenseNote model={model} />
      {/* Choosing the preset already chosen applies it again: its prompt, schema, model and sample afresh. */}
      <div className="desk-field" onClickCapture={e => {
        const label = (e.target as HTMLElement).closest('button, [role="radio"]')?.textContent
        const again = PRESETS.find(p => p.label === label && p.id === preset)
        if (again && !busy) applyPreset(again.id)
      }}>
        <span className="desk-label">Preset</span>
        <SegmentedControl label="Preset" size="small" width="fill" value={preset} onChange={applyPreset} disabled={busy}
          options={PRESETS.map(p => ({ value: p.id, label: p.label }))} />
      </div>
      <div className="desk-field">
        <span className="desk-label">Image</span>
        <div
          className="studio-inspect-drop"
          data-dragging={dragging || undefined}
          role="button"
          tabIndex={0}
          aria-label={picture ? `Image: ${picture.name}. Drop another here, or choose one` : 'Drop an image here, or choose one'}
          aria-disabled={busy || undefined}
          onClick={() => !busy && picker.current?.click()}
          onKeyDown={e => { if ((e.key === 'Enter' || e.key === ' ') && !busy) { e.preventDefault(); picker.current?.click() } }}
          onDragEnter={e => { e.preventDefault(); setDragging(true) }}
          onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy' }}
          onDragLeave={() => setDragging(false)}
          onDrop={e => { e.preventDefault(); setDragging(false); if (!busy) void takeFile(e.dataTransfer.files[0]) }}
        >
          {picture
            // eslint-disable-next-line @next/next/no-img-element -- the user's own image, read in the page
            ? <><img src={picture.url} alt="" /><span>{picture.name}</span></>
            : <span>Drop a PNG or JPEG here, or click to choose one</span>}
        </div>
        <input ref={picker} type="file" accept="image/png,image/jpeg" hidden onChange={e => { void takeFile(e.target.files?.[0]); e.target.value = '' }} />
        <div className="studio-inspect-samples">
          <span className="desk-help">Samples:</span>
          {SAMPLES.map(s => <Button key={s.url} size="small" intent="quiet" disabled={busy} onClick={() => void takeSample(s.url)}>{s.label}</Button>)}
        </div>
      </div>
      <TextArea label="Prompt" rows={4} value={prompt} onChange={e => setPrompt(e.target.value)} disabled={busy}
        help={ocr ? 'PaddleOCR-VL takes a task prompt (OCR:, Table Recognition:…). With a schema, it reads the text and Qwen3-VL fills the schema from it.' : undefined} />
      <Disclosure label="JSON schema" open={schemaOpen} onOpenChange={setSchemaOpen}
        summary={<span className="desk-text-small desk-text-muted">{schema ? 'the reply is held to it' : 'none: free text'}</span>}>
        <TextArea label="Schema" rows={10} value={schemaText} onChange={e => setSchemaText(e.target.value)} disabled={busy} spellCheck={false}
          className="desk-input studio-textarea studio-mono" help={schemaProblem ?? 'Leave it empty for a free-text answer.'} />
      </Disclosure>
      <div className="studio-actions">
        <Button intent="default" disabled={!model || !picture || busy || (!prompt.trim() && !ocr) || !!schemaProblem} onClick={() => void inspect()}>
          {busy ? 'Inspecting…' : 'Inspect'}
        </Button>
        {busy && <Button intent="quiet" onClick={() => abort.current?.abort()}>Stop</Button>}
      </div>
      {model && !model.loaded && !busy && (
        <p className="desk-text-small desk-text-muted">The first look loads {model.name} ({bytes(model.sizeBytes)}) onto the GPU first.</p>
      )}
    </Pane>
  )

  const answer = done?.json != null ? (
    <Tabs label="The reply" value={view} onChange={setView} tabs={[{ value: 'fields', label: 'Fields' }, { value: 'json', label: 'JSON' }]}>
      {view === 'fields'
        ? <FieldTables json={done.json} />
        : <CodeBlock label="JSON" language="json" code={JSON.stringify(done.json, null, 2)} />}
    </Tabs>
  ) : schema && (text || busy) ? (
    <pre className="studio-inspect-text studio-mono">{text || '…'}</pre>
  ) : text || busy ? (
    <div className="studio-inspect-text">{text ? <Prose text={text} /> : '…'}</div>
  ) : null

  return (
    <div className="studio-window">
      <StubNotice kind="vision" />
      <Split side={form} size={380} remember="fornax-studio.inspect" label="Resize the settings">
        <div className="studio-output">
          <div className="studio-chat-stats" aria-live="off">
            <Figures items={busy
              ? [['Now', working], ['Tokens', String(live.tokens)]]
              : done
                ? [['Reply', rate(done.tokensPerSecond)], ['First token', seconds(done.firstTokenSeconds)], ['Prompt', `${done.promptTokens} tokens`],
                    ['Generated', `${done.generatedTokens} tokens`], ['Total', seconds(done.seconds + (done.readSeconds ?? 0))],
                    ...(boxes.length ? [['Boxes', String(boxes.length)] as const] : [])]
                : [['Reply', '—']]} />
          </div>
          {problem && <p className="studio-failure">{problem}</p>}
          {picture ? (
            <div className="studio-inspect">
              <Stage picture={picture} boxes={boxes} />
              <div className="studio-inspect-answer">
                {reviewNote && <p className="studio-license desk-text-small" role="note"><strong>{current?.note}</strong></p>}
                {done?.finishReason === 'length' && <p className="studio-license desk-text-small" role="note">The reply ran out of tokens before it was finished.</p>}
                {read != null && (
                  <details className="studio-thinking">
                    <summary>Read by {read.by} in {seconds(read.seconds)}</summary>
                    <p>{read.text}</p>
                  </details>
                )}
                {answer}
              </div>
            </div>
          ) : (
            <div className="studio-hint">
              <h2>Inspect</h2>
              <p>A vision model through llama.cpp’s mtmd, in the JVM: an image and a question in, an answer out, as text or as JSON held to a schema. Pick a preset, or drop an image of your own.</p>
              <div className="studio-suggestions">
                {PRESETS.map(p => <Button key={p.id} size="small" onClick={() => applyPreset(p.id)}>{p.label}</Button>)}
              </div>
            </div>
          )}
        </div>
      </Split>
    </div>
  )
}
