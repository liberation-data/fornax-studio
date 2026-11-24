/*
 * Server-sent events read from a fetch reply: the backend answers a POST (a chat, an image, a song) with a stream of
 * `event:` / `data:` blocks, which EventSource can't send a body for. Each block is parsed as it completes.
 */

export interface StreamEvent {
  readonly event: string
  readonly data: unknown
}

/** Splits what has arrived into whole events and what is left over, to be completed by the next chunk. */
export function parseEvents(buffer: string): { events: StreamEvent[]; rest: string } {
  const events: StreamEvent[] = []
  const blocks = buffer.replace(/\r\n/g, '\n').split('\n\n')
  const rest = blocks.pop() ?? ''
  for (const block of blocks) {
    let event = 'message'
    const data: string[] = []
    for (const line of block.split('\n')) {
      if (line.startsWith('event:')) event = line.slice(6).trim()
      else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''))
    }
    if (data.length === 0) continue
    const text = data.join('\n')
    let parsed: unknown = text
    try {
      parsed = JSON.parse(text)
    } catch {
      // Not JSON: the text as it came.
    }
    events.push({ event, data: parsed })
  }
  return { events, rest }
}

/**
 * POSTs the body as JSON and calls onEvent for each event of the reply as it comes. A reply that is not a stream (a
 * request refused before anything began) is thrown as an Error with the backend's own message.
 */
export async function postStream(
  url: string,
  body: unknown,
  onEvent: (e: StreamEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
    body: JSON.stringify(body),
    signal,
  })
  if (!res.ok || !res.headers.get('content-type')?.startsWith('text/event-stream') || !res.body) {
    let message = `${res.status} ${res.statusText}`
    try {
      const reply = (await res.json()) as { error?: string }
      if (reply.error) message = reply.error
    } catch {
      // The status, then.
    }
    throw new Error(message)
  }
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader()
  let buffer = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += value
    const { events, rest } = parseEvents(buffer)
    buffer = rest
    for (const e of events) onEvent(e)
  }
  if (buffer.trim()) for (const e of parseEvents(buffer + '\n\n').events) onEvent(e)
}
