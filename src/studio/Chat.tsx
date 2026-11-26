'use client'

import { Button, Composer, Tabs, Thread, Toggle, Toolbar } from '@liberation-data/desk/react'
import type { Message as ThreadMessage } from '@liberation-data/desk/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AssistantMessage, ChatDone, LoadStatus, ToolResult } from './api'
import { rate, seconds, splitThinking } from './format'
import { Figures, ModelPicker, StubNotice } from './parts'
import { postStream } from './sse'
import { useStudio } from './state'

type Mode = 'chat' | 'tools'

/** One turn as the window keeps it: what was said, and for a reply, how it was made. */
interface Turn {
  id: string
  from: 'me' | 'fornax'
  text: string
  /** The reasoning, when the engine gave it apart from the text (chatJson's reasoning_content). */
  reasoning?: string
  /** The tools called on the way to this reply, and what each answered. */
  tools?: ToolResult[]
  done?: ChatDone
  failed?: string
  streaming?: boolean
}

/** The conversation sent to the backend: what was said, without the timings or the tool trail. */
function history(turns: readonly Turn[]) {
  return turns
    .filter(t => !t.failed && (t.from === 'me' || t.text))
    .map(t => ({ role: t.from === 'me' ? 'user' : 'assistant', content: t.from === 'me' ? t.text : splitThinking(t.text).answer }))
}

function Reply({ turn, showThinking }: { turn: Turn; showThinking: boolean }) {
  const { thinking, answer, thinkingOpen } = splitThinking(turn.text)
  const reasoning = turn.reasoning ?? thinking
  return (
    <div className="studio-reply">
      {turn.tools?.map((t, i) => (
        <div key={i} className="studio-tool-call">
          <code>{t.name}({JSON.stringify(t.arguments)})</code>
          <span aria-hidden="true"> → </span>
          <code className="studio-tool-result">{t.result}</code>
        </div>
      ))}
      {showThinking && reasoning ? (
        // Open while it is being written, and when it is all there is (a small model may answer only in its reasoning).
        <details className="studio-thinking" open={thinkingOpen || (!answer && !turn.streaming)}>
          <summary>{thinkingOpen ? 'Thinking…' : 'Thought'}</summary>
          <p>{reasoning}</p>
        </details>
      ) : null}
      {answer ? <p className="studio-answer">{answer}</p> : turn.streaming && !thinkingOpen ? <p className="studio-answer desk-text-muted">…</p> : null}
      {turn.failed && <p className="studio-failure-inline">{turn.failed}</p>}
      {turn.done && (
        <p className="studio-reply-stats desk-text-caption desk-text-muted">
          {rate(turn.done.tokensPerSecond)} · {turn.done.generatedTokens} tokens · first token {seconds(turn.done.firstTokenSeconds)} · {seconds(turn.done.seconds)}
        </p>
      )}
    </div>
  )
}

// A small model works sums out in its head unless told the tools are there for it.
const TOOLS_SYSTEM = 'You have tools. For any arithmetic, call calculate; for the date or time, call get_current_time. Never work these out yourself.'

const SUGGESTIONS: Record<Mode, string[]> = {
  chat: ['Write a haiku about a fornax.', 'Explain what a GGUF file is, in two sentences.', 'Name three uses for a pottery kiln.'],
  tools: ['What is (17 + 4) * 3 / 2?', 'What time is it in Tokyo right now?', 'What is 2^20, and what is the time in London?'],
}

/** A conversation with a chat model, streamed; or, in Tools, the model calling the backend's tools through chatJson. */
function Conversation({ mode, think }: { mode: Mode; think: boolean }) {
  const { chosen, refresh } = useStudio()
  const model = chosen('chat')
  const [turns, setTurns] = useState<Turn[]>([])
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState<LoadStatus | null>(null)
  const [live, setLive] = useState<{ tokens: number; first: number | null; now: number }>({ tokens: 0, first: null, now: 0 })
  const abort = useRef<AbortController | null>(null)
  const last = [...turns].reverse().find(t => t.done)?.done

  useEffect(() => () => abort.current?.abort(), [])

  const update = useCallback((id: string, change: (t: Turn) => Turn) => setTurns(all => all.map(t => (t.id === id ? change(t) : t))), [])

  const send = useCallback(async (text: string) => {
    if (!model || busy || !text.trim()) return
    const mine: Turn = { id: crypto.randomUUID(), from: 'me', text }
    const reply: Turn = { id: crypto.randomUUID(), from: 'fornax', text: '', streaming: true, ...(mode === 'tools' ? { tools: [] } : {}) }
    const sent = [...turns, mine]
    setTurns([...sent, reply])
    setDraft('')
    setBusy(true)
    setLive({ tokens: 0, first: null, now: performance.now() })
    const controller = new AbortController()
    abort.current = controller
    try {
      await postStream(mode === 'chat' ? '/api/chat' : '/api/chat/tools', {
        model: model.id,
        messages: mode === 'tools' ? [{ role: 'system', content: TOOLS_SYSTEM }, ...history(sent)] : history(sent),
        // Off adds Qwen3's /no_think switch, which only Qwen3 knows; any other model is left to itself.
        think: think || !/qwen3/i.test(model.id),
        maxTokens: 1024,
        temperature: 0.7,
      }, e => {
        const data = e.data as Record<string, unknown>
        if (e.event === 'status') {
          const s = data as unknown as LoadStatus
          setLoading(s.state === 'loading' ? s : null)
          if (s.state === 'loaded') refresh()
        } else if (e.event === 'token') {
          const piece = String(data.text ?? '')
          update(reply.id, t => ({ ...t, text: t.text + piece }))
          const now = performance.now()
          setLive(l => ({ tokens: l.tokens + 1, first: l.first ?? now, now }))
        } else if (e.event === 'assistant') {
          // A round of the tool exchange: its reasoning, and the reply's words when it answers in words.
          const message = data.message as AssistantMessage
          update(reply.id, t => ({
            ...t,
            reasoning: [t.reasoning, message.reasoning_content].filter(Boolean).join('\n\n') || undefined,
            text: message.tool_calls?.length ? '' : (message.content ?? t.text),
          }))
        } else if (e.event === 'tool') {
          update(reply.id, t => ({ ...t, tools: [...(t.tools ?? []), data as unknown as ToolResult] }))
        } else if (e.event === 'done') {
          update(reply.id, t => ({ ...t, streaming: false, done: data as unknown as ChatDone }))
        } else if (e.event === 'error') {
          update(reply.id, t => ({ ...t, streaming: false, failed: String(data.message ?? 'failed') }))
        }
      }, controller.signal)
    } catch (e) {
      const stopped = controller.signal.aborted
      update(reply.id, t => ({ ...t, streaming: false, failed: stopped ? 'Stopped.' : e instanceof Error ? e.message : String(e) }))
    } finally {
      setBusy(false)
      setLoading(null)
      abort.current = null
      refresh()
    }
  }, [model, busy, turns, mode, think, update, refresh])

  const messages = useMemo<ThreadMessage[]>(() => turns.map(t => ({
    id: t.id,
    from: t.from,
    authorName: t.from === 'me' ? 'You' : model?.name ?? 'Fornax',
    body: t.from === 'me' ? <p className="studio-answer">{t.text}</p> : <Reply turn={t} showThinking={think || mode === 'tools'} />,
    state: t.failed && t.failed !== 'Stopped.' ? 'failed' : 'sent',
  })), [turns, model, think, mode])

  const liveRate = live.first != null && live.now > live.first ? ((live.tokens - 1) * 1000) / (live.now - live.first) : null

  return (
    <div className="studio-chat">
      <StubNotice kind="chat" />
      <div className="studio-chat-stats" aria-live="off">
        <Figures items={busy
          ? [['Now', loading ? 'loading the model…' : liveRate ? rate(liveRate) : 'reading the prompt…'], ['Tokens', String(live.tokens)]]
          : last
            ? [['Last reply', rate(last.tokensPerSecond)], ['First token', seconds(last.firstTokenSeconds)], ['Prompt', `${last.promptTokens} tokens`], ['Reply', `${last.generatedTokens} tokens`], ['Total', seconds(last.seconds)]]
            : [['Last reply', '—']]} />
        {turns.length > 0 && <Button size="small" intent="quiet" disabled={busy} onClick={() => setTurns([])}>Clear</Button>}
      </div>
      <Thread
        label={mode === 'chat' ? 'Conversation' : 'Tool-calling conversation'}
        messages={messages}
        typing={busy && loading ? <span className="desk-text-small desk-text-muted">Loading {model?.name}…</span> : false}
        empty={
          <div className="studio-hint">
            <h2>{mode === 'chat' ? 'Chat' : 'Tool calling'}</h2>
            <p>
              {mode === 'chat'
                ? 'Streamed from llama.cpp, in the JVM, through a Java callback.'
                : 'The model is offered two tools, a clock and a calculator, through LlamaModel.chatJson. Each call it makes is run by the backend and the answer handed back.'}
            </p>
            <div className="studio-suggestions">
              {SUGGESTIONS[mode].map(s => <Button key={s} size="small" disabled={!model} onClick={() => void send(s)}>{s}</Button>)}
            </div>
          </div>
        }
      />
      <Composer
        value={draft}
        onChange={setDraft}
        onSubmit={text => void send(text)}
        placeholder={model ? `Message ${model.name}` : 'No chat model in the cache'}
        label="Message"
        disabled={!model}
        busy={busy}
        onStop={() => abort.current?.abort()}
      />
    </div>
  )
}

export function Chat() {
  const [mode, setMode] = useState<Mode>('chat')
  const [think, setThink] = useState(false)
  const { chosen } = useStudio()
  const model = chosen('chat')
  return (
    <div className="studio-window">
      <Toolbar label="Chat" trailing={<Toggle checked={think} onChange={setThink} label="Thinking" />}>
        <ModelPicker kind="chat" />
      </Toolbar>
      <Tabs
        label="Chat or tools"
        value={mode}
        onChange={setMode}
        tabs={[{ value: 'chat', label: 'Chat' }, { value: 'tools', label: 'Tools' }]}
      >
        {/* Both stay mounted, so switching keeps each conversation. */}
        <div className="studio-tab" hidden={mode !== 'chat'}><Conversation mode="chat" think={think} /></div>
        <div className="studio-tab" hidden={mode !== 'tools'}><Conversation mode="tools" think={think} /></div>
      </Tabs>
    </div>
  )
}
