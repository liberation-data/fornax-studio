'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { loadModel, loadStatus, unloadModel } from './api'
import type { Kind, Model, Status } from './api'

/**
 * What every window shares: the backend's status (the models in the cache, which are loaded, the memory in use), read
 * every few seconds and after anything that changes it, and the model chosen for each kind of work.
 */
interface Studio {
  status: Status | null
  /** Why the status could not be read, when it could not: the backend is down, most likely. */
  problem: string | null
  refresh: () => void
  chosen: (kind: Kind) => Model | null
  choose: (kind: Kind, id: string) => void
  load: (id: string) => Promise<void>
  unload: (id: string) => Promise<void>
  /** A load or unload asked for from the Models window, and not yet answered. */
  pending: ReadonlySet<string>
}

const StudioContext = createContext<Studio | null>(null)

export function useStudio(): Studio {
  const studio = useContext(StudioContext)
  if (!studio) throw new Error('useStudio outside the studio')
  return studio
}

const CHOSEN = 'kiln-studio.chosen'
const remembered = (): Partial<Record<Kind, string>> => {
  try {
    return JSON.parse(window.localStorage.getItem(CHOSEN) ?? '{}') as Partial<Record<Kind, string>>
  } catch {
    return {}
  }
}

/**
 * The model a window uses when none has been chosen, or the one chosen has gone: one already loaded, else the smallest
 * that can be, as the quickest to try.
 */
export function defaultModel(models: readonly Model[], kind: Kind, wanted?: string): Model | null {
  const ofKind = models.filter(m => m.kind === kind)
  const asked = ofKind.find(m => m.id === wanted && m.available)
  if (asked) return asked
  const usable = ofKind.filter(m => m.available)
  return usable.find(m => m.loaded) ?? [...usable].sort((a, b) => a.sizeBytes - b.sizeBytes)[0] ?? null
}

export function StudioProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [wanted, setWanted] = useState<Partial<Record<Kind, string>>>({})
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set())

  const refresh = useCallback(() => {
    loadStatus().then(
      s => {
        setStatus(s)
        setProblem(null)
      },
      (e: unknown) => setProblem(e instanceof Error ? e.message : String(e)),
    )
  }, [])

  useEffect(() => {
    setWanted(remembered())
    refresh()
    // Often enough to see a load finish or an idle model unloaded; it reads files' sizes, nothing more.
    const timer = window.setInterval(refresh, 3000)
    return () => window.clearInterval(timer)
  }, [refresh])

  const choose = useCallback((kind: Kind, id: string) => {
    setWanted(all => {
      const next = { ...all, [kind]: id }
      try {
        window.localStorage.setItem(CHOSEN, JSON.stringify(next))
      } catch {
        // Chosen for this visit only.
      }
      return next
    })
  }, [])

  const chosen = useCallback((kind: Kind) => defaultModel(status?.models ?? [], kind, wanted[kind]), [status, wanted])

  const track = useCallback(
    (id: string, work: () => Promise<unknown>) => {
      setPending(all => new Set([...all, id]))
      refresh()
      return work()
        .then(() => undefined)
        .finally(() => {
          setPending(all => new Set([...all].filter(p => p !== id)))
          refresh()
        })
    },
    [refresh],
  )
  const load = useCallback((id: string) => track(id, () => loadModel(id)), [track])
  const unload = useCallback((id: string) => track(id, () => unloadModel(id)), [track])

  const value = useMemo(
    () => ({ status, problem, refresh, chosen, choose, load, unload, pending }),
    [status, problem, refresh, chosen, choose, load, unload, pending],
  )
  return <StudioContext.Provider value={value}>{children}</StudioContext.Provider>
}
