/*
 * How the studio's server passes a request on to Kiln's backend: where the backend is, and which headers cross. The
 * desktop app sets KILN_STUDIO_SERVER when it starts both; from `npm run dev` it is the backend's default port.
 */

export const DEFAULT_BACKEND = 'http://127.0.0.1:5191'

export function backendUrl(path: readonly string[], search = '', base = process.env.KILN_STUDIO_SERVER ?? DEFAULT_BACKEND): string {
  const clean = path.map(segment => encodeURIComponent(segment)).join('/')
  return `${base.replace(/\/$/, '')}/api/${clean}${search}`
}

// Only what the backend reads: what is sent, and the byte range of a song asked for.
const FORWARDED = ['content-type', 'range', 'accept']

export function forwardedHeaders(headers: Headers): Headers {
  const out = new Headers()
  for (const name of FORWARDED) {
    const value = headers.get(name)
    if (value) out.set(name, value)
  }
  return out
}

// What the page needs of the reply; the length and encoding are the proxy's own to set.
const REPLIED = ['content-type', 'content-range', 'accept-ranges', 'cache-control']

export function replyHeaders(headers: Headers): Headers {
  const out = new Headers()
  for (const name of REPLIED) {
    const value = headers.get(name)
    if (value) out.set(name, value)
  }
  if (out.get('content-type')?.startsWith('text/event-stream')) {
    out.set('cache-control', 'no-cache, no-transform')
    out.set('x-accel-buffering', 'no')
  }
  return out
}
