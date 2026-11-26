import { afterEach, describe, expect, it, vi } from 'vitest'
import { planPull } from './api'

describe('planPull', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('throws a refused plan with the backend\'s failure, so the sheet can ask for a token', async () => {
    const failure = { id: 'video:ltx', reason: 'ACCESS_DENIED', message: 'gated', termsUrl: 'https://huggingface.co/x', error: 'gated' }
    vi.stubGlobal('fetch', async () => Response.json(failure, { status: 403 }))
    const e = (await planPull('video:ltx').catch((x: unknown) => x)) as Error & { failure: typeof failure }
    expect(e.message).toBe('gated')
    expect(e.failure).toMatchObject({ reason: 'ACCESS_DENIED', termsUrl: 'https://huggingface.co/x' })
  })

  it('throws the status when the reply is not JSON', async () => {
    vi.stubGlobal('fetch', async () => new Response('Bad Gateway', { status: 502, statusText: 'Bad Gateway' }))
    await expect(planPull('x')).rejects.toThrow('502 Bad Gateway')
  })
})
