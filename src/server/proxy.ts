/*
 * How the studio's server passes a request on to Fornax's backend: where the backend is, and which headers cross. The
 * desktop app sets FORNAX_STUDIO_SERVER when it starts both; from `npm run dev` it is the backend's default port.
 */

export const DEFAULT_BACKEND = 'http://127.0.0.1:5191'

export function backendUrl(path: readonly string[], search = '', base = process.env.FORNAX_STUDIO_SERVER ?? DEFAULT_BACKEND): string {
  const clean = path.map(segment => encodeURIComponent(segment)).join('/')
  return `${base.replace(/\/$/, '')}/api/${clean}${search}`
}

// Only what the backend reads: what is sent, and the byte range of a song asked for.
const FORWARDED = ['content-type', 'range', 'accept']

/** The header the backend requires the launch's secret in (fornax-studio-server's StudioServer.SECRET_HEADER). */
export const SECRET_HEADER = 'x-fornax-studio-secret'

/**
 * The headers the backend gets: what it reads, and the launch's secret, which the desktop app makes each launch and
 * passes to this server and the backend in FORNAX_STUDIO_SECRET. A browser's Origin never crosses: the backend refuses
 * any request that carries one.
 */
export function forwardedHeaders(headers: Headers, secret = process.env.FORNAX_STUDIO_SECRET): Headers {
  const out = new Headers()
  for (const name of FORWARDED) {
    const value = headers.get(name)
    if (value) out.set(name, value)
  }
  if (secret) out.set(SECRET_HEADER, secret)
  return out
}

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]'])

/**
 * Why a request to the studio's server is refused, or null. Listening on localhost doesn't keep out web pages in the
 * user's browser: they can POST here with no CORS preflight, and DNS rebinding gets round the same-origin check. So the
 * Host must be a loopback name (a rebound attacker's name isn't), and an Origin, when there is one, must be this page's
 * own: the Host it was sent to. A GET has no Origin even from another site (an <img>, <audio> or no-cors fetch), so its
 * Sec-Fetch-Site, which Chromium sends to localhost, must be same-origin or none (typed, or Electron's loadURL). A
 * request with neither (curl) is the user's own.
 */
export function refusal(headers: Headers): string | null {
  const host = headers.get('host')?.toLowerCase()
  if (!host) return 'only Fornax Studio may call this server (no Host)'
  const name = host.startsWith('[') ? host.slice(0, host.indexOf(']') + 1) : host.split(':')[0] ?? ''
  if (!LOOPBACK.has(name)) return 'only Fornax Studio may call this server (wrong Host)'
  const origin = headers.get('origin')
  if (origin != null && origin.toLowerCase() !== `http://${host}`) return 'only Fornax Studio may call this server (another page\'s Origin)'
  const site = headers.get('sec-fetch-site')
  if (site != null && site !== 'same-origin' && site !== 'none') return 'only Fornax Studio may call this server (another page\'s request)'
  return null
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
