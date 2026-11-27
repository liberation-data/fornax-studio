# Fornax Studio

Try models with Fornax: chat with a GGUF model and watch the tokens per second,
watch it call tools, make an image, a song or a video clip, ask a vision model about a picture, and see what is loaded
and how much memory it holds. Fornax
runs the engines (llama.cpp, stable-diffusion.cpp, acestep.cpp, yue2.cpp) inside one JVM, through Java's FFM API; Fornax Studio is the
desktop app around it, the sibling of [Drivine Studio](https://github.com/liberation-data/drivine-studio) and built the
same way: Next.js and Electron, on the [desk](https://www.npmjs.com/package/@liberation-data/desk).

> **Kiln Studio is now Fornax Studio.** It's the same app under a new name, so it installs alongside Kiln Studio rather
> than upgrading it. Uninstall Kiln Studio, then install Fornax Studio. Your settings (`~/.config/Kiln Studio`) and
> outputs (`~/.kiln-studio`) carry over: Fornax Studio keeps using them until it has its own. The command it installs is
> now `fornax`, not `kiln`.

![Fornax Studio's Chat window: Qwen3 0.6B answering, at 190 tokens a second](docs/screenshots/chat-light.png)

## Windows

- **Models**: what in the Hugging Face cache Fornax can run (every GGUF chat model, and the image, song, video and vision
  presets whose files are all there), which are loaded in Fornax's `ModelPool`, the memory they hold against its budget, and the GPU's
  own memory use. Load and unload from here. **Get models** lists the models Fornax knows by name that aren't all on
  disk: before each download a sheet gives its licence and its size against the free disk, and the download shows its
  rate and time left, carries on when the window closes, and resumes where it stopped. A gated repo (Gemma, LTX) needs
  its terms accepted on Hugging Face and a read token: the app keeps the token in the system's keychain and gives it to
  the backend, never to the page (with no keychain, or in a browser, set `HF_TOKEN` instead).
- **Chat**: a conversation streamed token by token, with tokens per second, time to the first token and token counts.
  **Thinking** shows Qwen3's reasoning (off sends Qwen3's `/no_think`). **Tools** offers the model a clock and a
  calculator through `LlamaModel.chatJson`: each call it makes is run by the backend and its answer handed back.
- **Image**: a prompt, size, steps, guidance and seed in; the image out, with the steps as they go and their timings.
- **Song**: a style, lyrics, length, BPM and key in; a 48 kHz song out, played in the window, with the time it took and
  the request as the engine resolved it. Two engines: ACE-Step 1.5, and YuE2 (style, lyrics and length only; it also
  shows the ABC score it composes first). YuE2's weights are CC BY-NC 4.0, no commercial use, which the window says
  when it is chosen.
- **Video**: LTX-2.5 through stable-diffusion.cpp: a prompt, an optional first frame, size, frames, fps, and sound on or
  off in; an .mp4 out, played in the window. Two-stage (the default) is Fornax's VideoClip recipe: a draft, the x2 latent
  upscaler, a refine at twice the size. Progress shows each stage's steps. A clip takes minutes; Stop cancels it at the
  next step. Needs `ffmpeg` (on the `PATH`, in `/opt/homebrew/bin` or `/usr/local/bin`, or `FORNAX_STUDIO_FFMPEG`) to make
  the .mp4.
- **Inspect**: an image (dropped on, chosen, or one of the samples) and a prompt in; a vision model's answer out,
  streamed with tokens per second, as free text or as JSON held to a schema (`LlamaModel.chatJson` with images, through
  llama.cpp's mtmd). Three models: Qwen3-VL 4B (the default), PaddleOCR-VL 1.6 and MedGemma 1.5 4B. Three presets fill
  the prompt and schema: **Read an invoice** (vendor, number, date, line items and totals, shown as JSON and as tables),
  **Find defects** (boxes as JSON, drawn over the image) and **Describe for review** (free text, with MedGemma: an aid
  for a clinician's review, not a diagnosis). PaddleOCR-VL takes task prompts (`OCR:`); given a schema, it reads the
  text and Qwen3-VL fills the schema from it. The samples are in `public/samples` (see its `NOTICE.md`): the invoice and
  the tray are drawn by `scripts/DrawSamples.java`, with made-up data; the chest X-ray is CC0, from Wikimedia Commons.
  MedGemma's weights are under Google's Health AI Developer Foundations terms, which the window says when it is chosen.

## The fornax command

Fornax has one download, and this is it: **Install fornax command…** (in the Fornax Studio menu on macOS, the File menu on
Linux) puts Fornax's command-line tool, `fornax` (`fornax pull`, `list`, `chat`, `test`, `info`), on your `PATH`, as VS
Code does for `code`. It writes fornax-cli's launcher, filled in with the app's own Java, the fornax command's jars and the
app's native libraries, so nothing else needs installing:

- Linux: `~/.local/bin/fornax` (the dialog says when `~/.local/bin` isn't on your `PATH`). The `.deb` and `.rpm` also
  write `/usr/bin/fornax` for every user when they install, and remove it when they're removed.
- macOS: `/usr/local/bin/fornax`, with an administrator's password when that folder isn't yours, or `~/.local/bin/fornax`.
  The app must be in Applications: it refuses to from its disk image, or from the temporary copy macOS runs an app
  from Downloads in, since the launcher points into the app.
- Windows: not yet (there is no Windows build).

A `fornax` that Fornax Studio didn't write is replaced only when you say so, and **Uninstall fornax command** removes only
Fornax Studio's own (it marks it with a `# fornax-studio-launcher` line). Install it again after moving the app. Then try
`fornax list`. The item is disabled when the app was built from a Fornax without fornax-cli.

## How it fits together

```
Electron (main.cjs)
 ├─ starts Fornax's backend:  java -jar server/fornax-studio-server.jar   (127.0.0.1:5191, FORNAX_STUDIO_PORT)
 ├─ starts the studio's Next.js server in Electron's own Node        (localhost:5190, PORT)
 └─ opens a window on it
page ──/api/*──▶ Next.js (src/app/api/[...path]) ──▶ fornax-studio-server ──FFM──▶ llama.cpp · stable-diffusion.cpp · acestep.cpp · yue2.cpp
```

The backend is `fornax-studio-server`, a module of the Fornax repository: JDK-only HTTP (`com.sun.net.httpserver`), replies
streamed as server-sent events, models kept in Fornax's `ModelPool`. The page talks only to the studio's own server, which
passes `/api/*` on as it is, so the browser app works the same from `npm start`. The backend is told the app's pid and
exits with it, so a model never stays on the GPU after the app has gone.

Listening on loopback doesn't keep out web pages in your browser, so both servers check who is calling. The studio's
server answers `/api/*` only for a loopback `Host` (not a DNS-rebound name), an `Origin` that is its own, and a
`Sec-Fetch-Site` of `same-origin` or `none`. The backend refuses any `Origin` and any non-loopback `Host`. The app also
makes a secret each launch and passes it, in the environment, to both servers as `FORNAX_STUDIO_SECRET`. The studio's
server adds it to every request it passes on, and the backend refuses a request without it. `npm run electron:dev` makes
no secret, so it works with a backend and dev server started on their own.

## Running it

Needs Node 22+, Java 25, and Fornax's native libraries (`native/build.sh` in the Fornax checkout).

```sh
npm install
npm run server:build   # builds fornax-studio-server in FORNAX_HOME (default ../fornax) into server/, with the native libraries
                       # and, when that Fornax has fornax-cli, the fornax command (server/fornax-cli)
npm run server:jre     # optional: a Java runtime for the app of its own, in server/jre (what a release ships)
npm run electron       # builds the page, then starts the app (and with it, the backend)
```

In development, each part on its own:

```sh
npm run server         # the backend on 5191
npm run dev            # the page on http://localhost:5190, with hot reload
npm run electron:dev   # the app on the dev server (uses the backend already running)
```

Settings, from the environment:

| Variable | |
|---|---|
| `HF_HUB_CACHE` / `HF_HOME` | where the models are (default `~/.cache/huggingface/hub`) |
| `HF_TOKEN` | a Hugging Face token for gated repos, when the app can't keep one in the keychain (or in a browser) |
| `FORNAX_STUDIO_STUB` | kinds of work answered by a stub that loads nothing, as `image,song,video` (or `chat`, `vision`): for trying the app without the GPU |
| `FORNAX_STUDIO_FFMPEG` | the ffmpeg that makes a video's .mp4 (else the `PATH`'s) |
| `GGML_VK_MAX_NODES_PER_SUBMIT` | Vulkan only: 8 unless set, so an LTX decode stays under amdgpu's compute timeout |
| `FORNAX_STUDIO_BUDGET_GB` | the pool's memory budget (24) |
| `FORNAX_STUDIO_IDLE_MINUTES` | unload a model idle this long (15) |
| `FORNAX_STUDIO_HOME` | where images, songs and videos are kept (`~/.fornax-studio`, in `outputs/`) |
| `FORNAX_HOME`, `FORNAX_NATIVE`, `FORNAX_BACKEND` | for `npm run server:build`: the Fornax checkout, and which native libraries to ship |
| `FORNAX_CLI_HOME` | for `npm run server:build`: the Fornax checkout to build the fornax command from (default `FORNAX_HOME`) |
| `FORNAX_STUDIO_JAR`, `FORNAX_LIBRARY_PATH`, `FORNAX_STUDIO_JAVA` | to run another backend jar, libraries or Java |
| `PORT`, `FORNAX_STUDIO_PORT` | the page's and the backend's ports (5190, 5191) |
| `FORNAX_STUDIO_SECRET` | set by the app each launch; when set, the backend answers only requests that carry it, and the studio's server adds it |

`npm run package:linux` packs the app with electron-builder, with the backend jar, the native libraries and, after
`npm run server:jre`, a Java runtime as resources (in `server/`). `server:jre` jlinks one from the JDK at `JAVA_HOME`
with only the modules the jar and the fornax command use (about 60 MB); the app and the fornax command it installs run it, `server/jre/bin/java`, and without it
`$JAVA_HOME/bin/java`, or `java` on the `PATH`.

## Releases

GitHub Actions builds what a release ships, from the Fornax commit in `fornax.ref` (bump it to take a newer Fornax):

- `fornax-backend.yml`, called by the two below once per platform: checks out Fornax, builds the engines the studio runs
  (`native/build.sh vulkan|metal llama sd acestep yue2`, cached), the backend jar and its jlink'd Java runtime, and
  checks that all four libraries are there and that the backend starts on it.
- `linux-build.yml`: a `.deb` and an `.rpm`, x64, Vulkan. They depend on the Vulkan loader, a Vulkan driver (Mesa's,
  unless NVIDIA's is already there) and OpenMP, so `dnf` or `apt` installs whatever is missing.
- `macos-signed.yml`: a `.dmg` and a `.zip` for Apple silicon and for Intel, Metal, signed with a Developer ID and
  notarized, in the `apple-signing` environment.

By hand (Actions, Run workflow) they keep what they built as the run's artifacts; on a published release (a `v*` tag)
they attach it to the release. Models are never bundled: the app finds them in the Hugging Face cache.

The workflows read the private Fornax repository with a deploy key: a read-only deploy key on `liberation-data/fornax`,
its private half in this repository's `KILN_DEPLOY_KEY` secret.

## Tests

```sh
npm test                                   # the page's helpers, the proxy, how the app starts the backend, the fornax command's launcher, file names
./gradlew :fornax-studio-server:test         # in the Fornax checkout: every route, over HTTP, with the engines stubbed
```

`checks.yml` runs `npm run typecheck` and `npm test` on every pull request and on main. Among them, `file-names.test.mjs`
fails on tracked paths that differ only in case (such as `Inspect.tsx` and `inspect.ts`), which a case-blind file system,
macOS's, takes for one.

## License

Apache 2.0.
