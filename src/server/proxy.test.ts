import { describe, expect, it } from 'vitest'
import { backendUrl, forwardedHeaders, replyHeaders } from './proxy'

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

  it('keeps a stream of events from being buffered', () => {
    const h = replyHeaders(new Headers({ 'content-type': 'text/event-stream; charset=utf-8', 'content-length': '5' }))
    expect(h.get('cache-control')).toBe('no-cache, no-transform')
    expect(h.get('content-length')).toBeNull()
  })
})
