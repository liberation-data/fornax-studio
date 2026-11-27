import type { NextRequest } from 'next/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { POST } from './route'

const request = (headers: Record<string, string>) =>
  ({ method: 'POST', headers: new Headers(headers), nextUrl: { search: '' }, text: async () => '{}', signal: undefined }) as unknown as NextRequest
const params = { params: Promise.resolve({ path: ['models', 'pull'] }) }

describe('the /api/* route', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('refuses another page\'s request without passing it on', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    const res = await POST(request({ host: 'localhost:5190', origin: 'https://evil.example' }), params)
    expect(res.status).toBe(403)
    expect(((await res.json()) as { error: string }).error).toMatch(/Origin/)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('passes the studio\'s own request on', async () => {
    const fetch = vi.fn(async () => new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', fetch)
    const res = await POST(request({ host: 'localhost:5190', origin: 'http://localhost:5190' }), params)
    expect(res.status).toBe(200)
    expect(fetch).toHaveBeenCalledOnce()
  })
})
