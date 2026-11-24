import { describe, expect, it } from 'vitest'
import { parseEvents } from './sse'

describe('parseEvents', () => {
  it('reads whole events and keeps the part still arriving', () => {
    const { events, rest } = parseEvents('event: token\ndata: {"text":"Hi"}\n\nevent: token\ndata: {"te')
    expect(events).toEqual([{ event: 'token', data: { text: 'Hi' } }])
    expect(rest).toBe('event: token\ndata: {"te')
  })

  it('takes several data lines as one, and text that is not JSON as text', () => {
    const { events } = parseEvents('data: one\ndata: two\n\n')
    expect(events).toEqual([{ event: 'message', data: 'one\ntwo' }])
  })

  it('reads CRLF line ends and skips comments', () => {
    const { events } = parseEvents(': ping\r\n\r\nevent: done\r\ndata: {"seconds":1}\r\n\r\n')
    expect(events).toEqual([{ event: 'done', data: { seconds: 1 } }])
  })
})
