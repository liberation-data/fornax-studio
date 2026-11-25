'use client'

import { createDesk, DeskCommands } from '@liberation-data/desk'
import type { WindowLimits } from '@liberation-data/desk'
import {
  Button, DeskShell, Desktop, Dock, MenuBar, dockItem, menuAction, menuCommand, menuSeparator, useDocumentTitle, windowMenuItems,
} from '@liberation-data/desk/react'
import { useMemo } from 'react'
import type { ReactNode } from 'react'
import { Chat } from './Chat'
import { ImageWindow } from './Image'
import { Models } from './Models'
import { Song } from './Song'
import { VideoWindow } from './Video'
import { bytes } from './format'
import { StudioProvider, useStudio } from './state'

const desk = createDesk()

const TITLES: Record<string, string> = { models: 'Models', chat: 'Chat', image: 'Image', song: 'Song', video: 'Video' }
const title = (id: string) => TITLES[id] ?? id

const LIMITS: Record<string, WindowLimits> = {
  models: { minWidth: 720, minHeight: 360 },
  chat: { minWidth: 480, minHeight: 400 },
  image: { minWidth: 720, minHeight: 480 },
  song: { minWidth: 720, minHeight: 480 },
  video: { minWidth: 760, minHeight: 520 },
}

function infoOf(id: string): ReactNode {
  if (id === 'models') return 'What in the Hugging Face cache Kiln can run: every GGUF chat model, and the image, song and video presets whose files are all downloaded. Kiln’s ModelPool keeps what is loaded between uses, within a memory budget.'
  if (id === 'chat') return 'A GGUF model through llama.cpp, streamed token by token from a Java callback. Tools offers the model a clock and a calculator through LlamaModel.chatJson, the OpenAI-style tool-calling API.'
  if (id === 'image') return 'stable-diffusion.cpp through Kiln’s DiffusionModel: FLUX.2 [klein] and Qwen-Image. Each step is reported as it finishes.'
  if (id === 'song') return 'ACE-Step 1.5 through Kiln’s AceStepModel, or YuE2 through its Yue2Model: a style and lyrics in, a 48 kHz stereo song out. YuE2’s weights are CC BY-NC 4.0: no commercial use.'
  if (id === 'video') return 'LTX-2.5 through Kiln’s DiffusionModel.generateVideo, with the two-stage recipe: a draft, the x2 latent upscaler, then a refine. Picture and sound are made together; ffmpeg makes the .mp4.'
  return null
}

// Module scope, so the desk's memoisation of window content holds.
function renderWindow(id: string): ReactNode {
  if (id === 'models') return <Models />
  if (id === 'chat') return <Chat />
  if (id === 'image') return <ImageWindow />
  if (id === 'song') return <Song />
  if (id === 'video') return <VideoWindow />
  return null
}

const icon = (path: string) => (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={path} />
  </svg>
)

const DOCK = [
  dockItem({ id: 'models', label: 'Models', description: 'What is in the cache, what is loaded, and the memory in use', icon: icon('M12 2l9 5-9 5-9-5 9-5zM3 12l9 5 9-5M3 17l9 5 9-5') }),
  dockItem({ id: 'chat', label: 'Chat', description: 'Chat with a GGUF model, and watch it call tools', icon: icon('M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12zM8 12h.01M12 12h.01M16 12h.01') }),
  dockItem({ id: 'image', label: 'Image', description: 'A prompt in, an image out', icon: icon('M5 4h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zM8.5 10a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM20 15l-5-5L5 20') }),
  dockItem({ id: 'song', label: 'Song', description: 'A style and lyrics in, a song out', icon: icon('M9 18V5l12-2v13M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0zM21 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0z') }),
  dockItem({ id: 'video', label: 'Video', description: 'A prompt in, a clip with sound out', icon: icon('M4 6h11a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1zM16 10l5-3v10l-5-3') }),
]

function Studio() {
  const { status, problem, refresh } = useStudio()
  useDocumentTitle(title, { app: 'Kiln Studio' })

  const menus = useMemo(() => [
    { id: 'studio', label: 'Kiln Studio', emphasis: true, items: [
        menuAction('Models…', () => desk.open('models')),
        menuAction('Reload the Cache', refresh),
        menuSeparator(),
        menuAction('Unload Every Model', () => void fetch('/api/models/unload', { method: 'POST', body: JSON.stringify({ id: '*' }) }).then(refresh)),
      ] },
    { id: 'window', label: 'Window', items: () => [
        ...['models', 'chat', 'image', 'song', 'video'].map(id => menuAction(title(id), () => desk.open(id))),
        menuSeparator(),
        menuCommand('Arrange', DeskCommands.arrange, { shortcut: 'mod+alt+a' }),
        menuSeparator(),
        ...windowMenuItems(desk.getState(), id => desk.focus(id), title),
      ] },
  ], [refresh])

  // What Kiln holds, at the end of the menu bar: the models loaded and their memory, or that the backend is down.
  const loaded = status?.models.filter(m => m.loaded && !m.stub) ?? []
  const status_ = useMemo(() => [{
    id: 'pool',
    label: problem ? 'Backend down' : `${loaded.length} loaded`,
    title: (
      <span className="studio-pool">
        <span className="studio-pool-dot" data-state={problem ? 'down' : loaded.length ? 'loaded' : 'idle'} aria-hidden="true" />
        {problem ? 'Kiln backend not answering' : loaded.length ? `${loaded.length} loaded · ${bytes(status?.loadedBytes)}` : 'Nothing loaded'}
      </span>
    ),
    items: () => [
      ...loaded.map(m => menuAction(m.name, () => desk.open('models'), { detail: bytes(m.sizeBytes) })),
      ...(loaded.length ? [menuSeparator()] : []),
      menuAction('Models…', () => desk.open('models')),
    ],
  }], [problem, loaded, status?.loadedBytes])

  return (
    <div className="studio">
      <MenuBar menus={menus} status={status_} leading={<span className="studio-mark" role="img" aria-label="Kiln" />} />
      <main className="studio-screen">
        <Desktop
          title={title}
          renderWindow={renderWindow}
          info={infoOf}
          limits={id => LIMITS[id] ?? null}
          empty={
            <div className="studio-hint studio-welcome">
              <h2>Kiln Studio</h2>
              <p>Open-weight models as plain Java calls, on your GPU, in one JVM. Try a chat model, an image model, a song model or a video model from your Hugging Face cache.</p>
              <div className="studio-hint-actions">
                <Button onClick={() => desk.open('models')}>Models</Button>
                <Button onClick={() => desk.open('chat')}>Chat</Button>
                <Button onClick={() => desk.open('image')}>Image</Button>
                <Button onClick={() => desk.open('song')}>Song</Button>
                <Button onClick={() => desk.open('video')}>Video</Button>
              </div>
            </div>
          }
        />
        <Dock entries={DOCK} label="Studio dock" />
      </main>
    </div>
  )
}

export function App() {
  return (
    <DeskShell desk={desk}>
      <StudioProvider>
        <Studio />
      </StudioProvider>
    </DeskShell>
  )
}

/** For a screenshot or a link: the windows to open at start, from ?open=chat,models (the last is in front). */
export function openFromQuery(search: string) {
  const ids = new URLSearchParams(search).get('open')?.split(',').filter(id => id in TITLES) ?? []
  for (const id of ids) desk.open(id)
}
