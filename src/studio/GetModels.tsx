'use client'

import { Button, Led, Section, Sheet, Table, TextField } from '@liberation-data/desk/react'
import type { Column } from '@liberation-data/desk/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { cancelPull, hubStatus, loadCatalogue, planPull } from './api'
import type { CatalogueSet, PullFailure, PullPlan, PullProgress } from './api'
import { catalogueEmpty, latest, offered, progressWords, setState } from './downloads'
import { bytes, partsWords } from './format'
import { licenseName } from './parts'
import { postStream } from './sse'

const KIND: Record<CatalogueSet['kind'], string> = {
  chat: 'Chat', vision: 'Vision', speech: 'Speech', transcription: 'Transcription', image: 'Image', song: 'Song', video: 'Video',
}

/** What the sheet before a download knows: the plan once the Hub has answered, or why it couldn't. */
interface Asking {
  set: CatalogueSet
  plan: PullPlan | null
  failure: PullFailure | null
}

/**
 * Fornax's catalogue, to get from inside the studio: each set's state, a Get button, and while it downloads its progress
 * (MB/s, time left) and Cancel. The download belongs to the backend: closing the window doesn't stop it, and opening the
 * window again shows it. Before a download, a sheet says what it is: its licence, its size against the free disk, and for
 * a gated repo, the terms to accept and the token to give.
 */
export function GetModels({ onGot }: { onGot: () => void }) {
  const [sets, setSets] = useState<CatalogueSet[] | null>(null)
  const [progress, setProgress] = useState<Record<string, PullProgress>>({})
  const [failures, setFailures] = useState<Record<string, PullFailure>>({})
  const [asking, setAsking] = useState<Asking | null>(null)
  const watching = useRef(new Map<string, AbortController>())
  /** Sets this window has got, kept in the list so their row says Downloaded. */
  const [got, setGot] = useState<ReadonlySet<string>>(new Set())

  const [problem, setProblem] = useState<string | null>(null)
  // Only the latest read of the catalogue is taken: an earlier one answering late would show a download that has since
  // ended as under way, and the effect below would start it again. Likewise a plan asked before the token changed.
  const catalogue = useMemo(latest, [])
  const plans = useMemo(latest, [])

  const refresh = useCallback(() => {
    catalogue(loadCatalogue(), c => {
      setSets(c.models)
      setProblem(null)
    }, (e: unknown) => {
      setProblem(e instanceof Error ? e.message : String(e))
      setSets(s => s ?? [])
    })
  }, [catalogue])

  /** Starts the set's download, or watches the one under way, until it ends. */
  const watch = useCallback((id: string) => {
    if (watching.current.has(id)) return
    const abort = new AbortController()
    watching.current.set(id, abort)
    setFailures(f => {
      const { [id]: _, ...rest } = f
      return rest
    })
    postStream('/api/models/pull', { id }, e => {
      if (e.event === 'progress') setProgress(p => ({ ...p, [id]: e.data as PullProgress }))
      else if (e.event === 'error') setFailures(f => ({ ...f, [id]: e.data as PullFailure }))
      else if (e.event === 'done') {
        setGot(g => new Set(g).add(id))
        onGot()
      }
    }, abort.signal)
      .catch((err: unknown) => {
        if (!abort.signal.aborted) setFailures(f => ({ ...f, [id]: { id, reason: 'IO', message: err instanceof Error ? err.message : String(err) } }))
      })
      .finally(() => {
        watching.current.delete(id)
        setProgress(p => {
          const { [id]: _, ...rest } = p
          return rest
        })
        refresh()
      })
  }, [onGot, refresh])

  useEffect(refresh, [refresh])
  // A download the backend has under way (started before this window opened) is watched again.
  useEffect(() => {
    for (const s of sets ?? []) if (s.downloading) watch(s.id)
  }, [sets, watch])
  // Leaving stops watching, not downloading.
  useEffect(() => () => {
    for (const a of watching.current.values()) a.abort()
  }, [])

  const ask = useCallback((set: CatalogueSet) => {
    setAsking({ set, plan: null, failure: null })
    plans(planPull(set.id),
      plan => setAsking(a => (a?.set.id === set.id ? { ...a, plan } : a)),
      (e: unknown) => {
        const { failure, message } = e as Error & { failure?: PullFailure }
        setAsking(a => (a?.set.id === set.id ? { ...a, failure: failure ?? { id: set.id, reason: 'IO', message } } : a))
      },
    )
  }, [plans])

  const columns = useMemo<Column<CatalogueSet>[]>(() => [
    {
      key: 'state', header: 'State', width: '9.5rem',
      render: s => {
        const st = setState(s, progress[s.id] ?? null)
        return <span className="studio-state"><Led color={failures[s.id] ? 'red' : st.color} />{failures[s.id] ? 'Failed' : st.words}</span>
      },
    },
    {
      key: 'title', header: 'Model', width: '50%',
      render: s => {
        const p = progress[s.id]
        const failure = failures[s.id]
        return (
          <div className="studio-model-name">
            <span>
              {s.title}
              {s.license && <span className="studio-badge" title={s.license}>{licenseName(s.license)}</span>}
              {s.gated && <span className="studio-badge" title="Accept the model's terms on Hugging Face, and give a token, to download it">gated</span>}
            </span>
            {p ? (
              <>
                <div className="studio-meter-track" role="progressbar" aria-label={`Downloading ${s.title}`}
                  aria-valuemin={0} aria-valuemax={100} aria-valuenow={p.fraction >= 0 ? Math.round(p.fraction * 100) : undefined}>
                  <div className="studio-meter-fill" style={{ width: `${Math.max(0, p.fraction) * 100}%` }} />
                </div>
                <span className="desk-text-caption desk-text-muted">{progressWords(p)}</span>
              </>
            ) : failure ? (
              <span className="desk-text-caption studio-failure">
                {failure.message}
                {failure.termsUrl && <> <a href={failure.termsUrl} target="_blank" rel="noreferrer">Accept the terms</a></>}
              </span>
            ) : (
              <span className="desk-text-caption desk-text-muted">
                {partsWords(s.parts)}
                {s.state === 'PARTIAL' && ` · ${bytes(s.bytesOnDisk)} so far`}
              </span>
            )}
          </div>
        )
      },
    },
    { key: 'kind', header: 'Kind', width: '6rem', render: s => KIND[s.kind] },
    {
      key: 'action', header: <span className="studio-sr">Action</span>, width: '6.5rem', align: 'end',
      render: s => s.downloading || progress[s.id]
        ? <Button size="small" onClick={() => void cancelPull(s.id).finally(refresh)}>Cancel</Button>
        : s.state === 'PRESENT' ? null
        : <Button size="small" onClick={() => ask(s)}>{s.state === 'PARTIAL' ? 'Resume' : 'Get'}</Button>,
    },
  ], [progress, failures, ask, refresh])

  return (
    <Section title="Get models">
      <Table
        label="Models Fornax knows by name"
        rows={offered(sets ?? [], got)}
        columns={columns}
        rowId={s => s.id}
        empty={catalogueEmpty(sets, problem)}
      />
      {asking && (
        <BeforeDownload
          asking={asking}
          onCancel={() => setAsking(null)}
          onGet={() => {
            watch(asking.set.id)
            setAsking(null)
          }}
          onTokenChanged={() => ask(asking.set)}
        />
      )}
    </Section>
  )
}

/** What a download is before it starts: licence, size against free disk, and for a gated repo its terms and the token. */
function BeforeDownload({ asking, onCancel, onGet, onTokenChanged }: {
  asking: Asking
  onCancel: () => void
  onGet: () => void
  onTokenChanged: () => void
}) {
  const { set, plan, failure } = asking
  const tooBig = plan != null && plan.bytesToDownload > plan.freeBytes
  const needsToken = failure?.reason === 'ACCESS_DENIED'
  return (
    <Sheet
      open
      onDismiss={onCancel}
      title={`Get ${set.title}`}
      description={plan ? `${bytes(plan.bytesToDownload)} to download, ${bytes(plan.freeBytes)} free.` : failure ? null : 'Asking Hugging Face for its size…'}
      actions={<>
        <Button onClick={onCancel}>Cancel</Button>
        <Button intent="default" disabled={!plan || tooBig} onClick={onGet}>Download</Button>
      </>}
    >
      <div className="studio-get-sheet">
        {set.license && (
          <p><strong>Licence:</strong> {set.license}. Check that it allows what you mean to do before you download it.</p>
        )}
        {tooBig && <p className="studio-failure">There isn&apos;t room: free some disk, or point HF_HUB_CACHE at a bigger one.</p>}
        {set.gated && set.termsUrl && (
          <p>Its repo is gated: <a href={set.termsUrl} target="_blank" rel="noreferrer">accept its terms on Hugging Face</a>, then give a token that can read it.</p>
        )}
        {failure && !needsToken && <p className="studio-failure">{failure.message}</p>}
        {(set.gated || needsToken) && <HubToken denied={needsToken} termsUrl={failure?.termsUrl ?? set.termsUrl} onChanged={onTokenChanged} />}
      </div>
    </Sheet>
  )
}

/**
 * The Hugging Face token, kept in the system's keychain by the desktop app, which gives it to the backend. The page
 * never reads it back: it only learns whether one is kept. In a browser there is no keychain: set HF_TOKEN instead.
 */
function HubToken({ denied, termsUrl, onChanged }: { denied: boolean; termsUrl: string | null; onChanged: () => void }) {
  const native = typeof window !== 'undefined' ? window.studioNative : undefined
  const [kept, setKept] = useState<{ set: boolean; usable: boolean } | null>(null)
  const [token, setToken] = useState('')
  const [problem, setProblem] = useState<string | null>(null)

  useEffect(() => {
    if (native) void native.hubToken().then(setKept)
    else void hubStatus().then(h => setKept({ set: h.tokenSet, usable: false }), () => setKept(null))
  }, [native])

  const save = (value: string | null) => {
    if (!native) return
    setProblem(null)
    native.saveHubToken(value).then(r => {
      setKept(r)
      setToken('')
      onChanged()
    }, (e: unknown) => setProblem(e instanceof Error ? e.message : String(e)))
  }

  return (
    <div className="studio-get-token">
      {denied && (
        <p className="studio-failure">
          Hugging Face refused the download{kept?.set ? ' with the token kept' : ': it needs a token'}.
          {termsUrl && <> Check that you <a href={termsUrl} target="_blank" rel="noreferrer">accepted its terms</a>.</>}
        </p>
      )}
      {!native ? (
        <p className="desk-text-small desk-text-muted">
          {kept?.set ? 'The backend has a token.' : 'Set HF_TOKEN for Fornax’s backend to a token that can read this repo, then try again.'}
        </p>
      ) : kept && !kept.usable ? (
        <p className="desk-text-small desk-text-muted">This system has no keychain to keep a token in. Set HF_TOKEN before starting Fornax Studio.</p>
      ) : (
        <>
          <TextField
            label={kept?.set ? 'Replace the Hugging Face token' : 'Hugging Face token'}
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={token}
            onChange={e => setToken(e.target.value)}
            help={<>A read token from <a href="https://huggingface.co/settings/tokens" target="_blank" rel="noreferrer">huggingface.co/settings/tokens</a>, kept in your system&apos;s keychain.</>}
            error={problem ?? undefined}
          />
          <div className="studio-get-token-actions">
            <Button size="small" disabled={!token.trim()} onClick={() => save(token)}>Save token</Button>
            {kept?.set && <Button size="small" intent="quiet" onClick={() => save(null)}>Forget token</Button>}
          </div>
        </>
      )}
    </div>
  )
}
