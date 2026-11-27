'use client'

import { Button, Led, Pane, PaneHeader, Section, Table } from '@liberation-data/desk/react'
import type { Column } from '@liberation-data/desk/react'
import { useMemo } from 'react'
import type { GpuMemory, Model } from './api'
import { bytes, partsWords, seconds } from './format'
import { GetModels } from './GetModels'
import { licenseName } from './parts'
import { useStudio } from './state'

const KIND = { chat: 'Chat', image: 'Image', song: 'Song', video: 'Video', vision: 'Vision' } as const

/** A share of a whole, as a bar and in words. */
function Meter({ label, used, total }: { label: string; used: number | null; total: number | null }) {
  const share = used != null && total ? Math.min(1, used / total) : 0
  return (
    <div className="studio-meter">
      <div className="studio-meter-head">
        <span>{label}</span>
        <span className="desk-text-muted">{bytes(used)} of {bytes(total)}</span>
      </div>
      <div className="studio-meter-track" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={total ?? 0} aria-valuenow={used ?? 0}>
        <div className="studio-meter-fill" style={{ width: `${share * 100}%` }} data-high={share > 0.85 || undefined} />
      </div>
    </div>
  )
}

function gpuMeters(gpu: readonly GpuMemory[]) {
  return gpu.flatMap(g => [
    ...(g.vramTotal ? [<Meter key={`${g.card}-vram`} label={`GPU memory (VRAM, ${g.card}, all processes)`} used={g.vramUsed} total={g.vramTotal} />] : []),
    ...(g.gttTotal ? [<Meter key={`${g.card}-gtt`} label={`GPU-mapped system memory (GTT, all processes)`} used={g.gttUsed} total={g.gttTotal} />] : []),
  ])
}

function state(m: Model, pending: boolean): { color: 'green' | 'amber' | 'off' | 'red'; words: string } {
  if (!m.available) return { color: 'red', words: 'Missing files' }
  if (m.loading || (pending && !m.loaded)) return { color: 'amber', words: 'Loading…' }
  if (m.inUse) return { color: 'green', words: 'Working' }
  if (m.loaded) return { color: 'green', words: m.stub ? 'Loaded (stub)' : 'Loaded' }
  return { color: 'off', words: 'In the cache' }
}

/** The models Fornax can run from the Hugging Face cache, which are loaded, the memory they hold, and the ones to get. */
export function Models() {
  const { status, problem, refresh, load, unload, pending } = useStudio()

  const columns = useMemo<Column<Model>[]>(() => [
    {
      key: 'state', header: 'State', width: '8rem',
      render: m => {
        const s = state(m, pending.has(m.id))
        return <span className="studio-state"><Led color={s.color} />{s.words}</span>
      },
    },
    {
      key: 'name', header: 'Model', width: '45%',
      render: m => (
        <div className="studio-model-name">
          <span>{m.name}{m.stub && <span className="studio-badge">stub</span>}{m.license && <span className="studio-badge" title={m.license}>{licenseName(m.license)}</span>}</span>
          <span className="desk-text-caption desk-text-muted">
            {m.available
              ? partsWords(m.parts)
              : `Missing: ${m.parts.filter(p => !p.present).map(p => `${p.repo} ${p.file}`).join('; ')}`}
          </span>
        </div>
      ),
    },
    {
      key: 'engine', header: 'Engine', width: '8.5rem',
      render: m => (
        <div className="studio-model-name">
          <span>{m.engine}</span>
          <span className="desk-text-caption desk-text-muted">{KIND[m.kind]}</span>
        </div>
      ),
    },
    { key: 'sizeBytes', header: 'Size', numeric: true, width: '5.5rem', render: m => bytes(m.sizeBytes) },
    { key: 'loadSeconds', header: 'Load', numeric: true, width: '5rem', render: m => (m.loadSeconds == null ? '—' : seconds(m.loadSeconds)) },
    {
      key: 'action', header: <span className="studio-sr">Action</span>, width: '6rem', align: 'end',
      render: m => m.loaded
        ? <Button size="small" disabled={m.inUse || pending.has(m.id)} onClick={() => void unload(m.id)}>Unload</Button>
        : <Button size="small" disabled={!m.available || m.loading || pending.has(m.id)} onClick={() => void load(m.id)}>Load</Button>,
    },
  ], [load, unload, pending])

  // A stub holds nothing, so only the real ones count as loaded.
  const loaded = status?.models.filter(m => m.loaded && !m.stub) ?? []

  return (
    <Pane
      label="Models"
      header={<PaneHeader title="Models" actions={<Button size="small" intent="quiet" onClick={refresh}>Refresh</Button>} />}
      footer={status && <p className="studio-footnote desk-text-caption desk-text-muted">Hugging Face cache: {status.cacheRoot}</p>}
    >
      <div className="studio-models">
        {problem && <p className="studio-failure">Fornax&apos;s backend is not answering: {problem}</p>}
        {status && (
          <Section title="Memory">
            <div className="studio-meters">
              <Meter label={`Loaded by Fornax (${loaded.length} model${loaded.length === 1 ? '' : 's'}, estimated from the weights)`} used={status.loadedBytes} total={status.budgetBytes} />
              {gpuMeters(status.gpu)}
            </div>
            <p className="desk-text-small desk-text-muted">
              Fornax&apos;s pool keeps models loaded between uses within its budget, unloading the least recently used to make room, and any idle for a while.
            </p>
          </Section>
        )}
        <GetModels onGot={refresh} />
        <Section title="In the cache">
          <Table
            label="Models in the cache"
            rows={status?.models ?? []}
            columns={columns}
            rowId={m => m.id}
            empty={status ? 'Nothing in the cache that Fornax can run yet. Get one above.' : 'Reading the cache…'}
          />
        </Section>
      </div>
    </Pane>
  )
}
