import { describe, expect, it } from 'vitest'
import { backendUrl, forwardedHeaders, refusal, replyHeaders, SECRET_HEADER } from './proxy'

describe('the proxy to the backend', () => {
  it('keeps the path and query, and escapes each segment', () => {
    expect(backendUrl(['models', 'load'], '', 'http://127.0.0.1:5191')).toBe('http://127.0.0.1:5191/api/models/load')
    expect(backendUrl(['outputs', 'a b.png'], '?x=1', 'http://h:1/')).toBe('http://h:1/api/outputs/a%20b.png?x=1')
  })

  it('passes on only what the backend reads', () => {
    const h = forwardedHeaders(new Headers({ 'content-type': 'application/json', range: 'bytes=0-1', cookie: 'secret' }))
    expect(h.get('content-type')).toBe('application/json')
    expect(h.get('range')).toBe('bytes=0-1')
    expect(h.get('cookie')).toBeNull()
  })

  it('never passes on an Origin, and adds the launch\'s secret when there is one', () => {
    const h = forwardedHeaders(new Headers({ origin: 'http://localhost:5190', host: 'localhost:5190' }), 'launch-secret')
    expect(h.get('origin')).toBeNull()
    expect(h.get('host')).toBeNull()
    expect(h.get(SECRET_HEADER)).toBe('launch-secret')
    expect(forwardedHeaders(new Headers(), undefined).get(SECRET_HEADER)).toBeNull()
  })

  it('serves the studio\'s own page, and the user\'s own requests', () => {
    for (const host of ['localhost:5190', '127.0.0.1:5190', '[::1]:5190', 'LOCALHOST:5190']) {
      expect(refusal(new Headers({ host }))).toBeNull()
      expect(refusal(new Headers({ host, origin: `http://${host.toLowerCase()}` }))).toBeNull()
    }
  })

  it('refuses a web page\'s request, and a rebound name', () => {
    expect(refusal(new Headers({ host: 'localhost:5190', origin: 'https://evil.example' }))).toMatch(/Origin/)
    expect(refusal(new Headers({ host: 'localhost:5190', origin: 'http://localhost:3000' }))).toMatch(/Origin/)
    expect(refusal(new Headers({ host: 'localhost:5190', origin: 'null' }))).toMatch(/Origin/)
    for (const host of ['evil.example:5190', 'localhost.evil.example:5190', '127.0.0.1.nip.io:5190', '0.0.0.0:5190'])
      expect(refusal(new Headers({ host }))).toMatch(/wrong Host/)
    expect(refusal(new Headers())).toMatch(/no Host/)
  })

  it('refuses another page\'s GET, which carries no Origin, by its Sec-Fetch-Site', () => {
    // An <img>, <audio> or no-cors fetch from any site sends no Origin with a GET, but Chromium says where it came from.
    for (const site of ['cross-site', 'same-site'])
      expect(refusal(new Headers({ host: 'localhost:5190', 'sec-fetch-site': site }))).toMatch(/another page/)
    for (const site of ['same-origin', 'none'])
      expect(refusal(new Headers({ host: 'localhost:5190', 'sec-fetch-site': site }))).toBeNull()
  })

  it('keeps a stream of events from being buffered', () => {
    const h = replyHeaders(new Headers({ 'content-type': 'text/event-stream; charset=utf-8', 'content-length': '5' }))
    expect(h.get('cache-control')).toBe('no-cache, no-transform')
    expect(h.get('content-length')).toBeNull()
  })
})
