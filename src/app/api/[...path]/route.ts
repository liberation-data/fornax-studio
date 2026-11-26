import type { NextRequest } from 'next/server'
import { backendUrl, forwardedHeaders, refusal, replyHeaders } from '../../../server/proxy'

// Every /api/* request goes on to Fornax's backend (fornax-studio-server) as it is, and its reply comes back as it is sent:
// a stream of server-sent events is passed on event by event, and a song's bytes by the range asked for.
export const dynamic = 'force-dynamic'

async function forward(request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const refused = refusal(request.headers)
  if (refused) return Response.json({ error: refused }, { status: 403 })
  const { path } = await params
  const url = backendUrl(path, request.nextUrl.search)
  try {
    const upstream = await fetch(url, {
      method: request.method,
      headers: forwardedHeaders(request.headers),
      body: request.method === 'GET' || request.method === 'HEAD' ? undefined : await request.text(),
      // The page going stops the stream from the backend too.
      signal: request.signal,
      cache: 'no-store',
    })
    return new Response(upstream.body, { status: upstream.status, headers: replyHeaders(upstream.headers) })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    return Response.json({ error: `Fornax's backend did not answer at ${url}: ${message}` }, { status: 502 })
  }
}

export { forward as GET, forward as POST, forward as HEAD }
