# Kiln Studio

Try models with Kiln: chat with a GGUF model and watch the tokens per second,
watch it call tools, make an image or a song, and see what is loaded and how much memory it holds. Kiln runs the
engines (llama.cpp, stable-diffusion.cpp, acestep.cpp) inside one JVM, through Java's FFM API; Kiln Studio is the
desktop app around it, the sibling of [Drivine Studio](https://github.com/liberation-data/drivine-studio) and built the
same way: Next.js and Electron, on the [desk](https://www.npmjs.com/package/@liberation-data/desk).

![Kiln Studio's Chat window: Qwen3 0.6B answering, at 190 tokens a second](docs/screenshots/chat-light.png)

## Windows

- **Models**: what in the Hugging Face cache Kiln can run (every GGUF chat model, and the image and song presets whose
  files are all there), which are loaded in Kiln's `ModelPool`, the memory they hold against its budget, and the GPU's
  own memory use. Load and unload from here.
- **Chat**: a conversation streamed token by token, with tokens per second, time to the first token and token counts.
  **Thinking** shows Qwen3's reasoning (off sends Qwen3's `/no_think`). **Tools** offers the model a clock and a
  calculator through `LlamaModel.chatJson`: each call it makes is run by the backend and its answer handed back.
- **Image**: a prompt, size, steps, guidance and seed in; the image out, with the steps as they go and their timings.
- **Song**: a style, lyrics, length, BPM and key in; a 48 kHz song out, played in the window, with the time it took and
  the request as ACE-Step resolved it.

## How it fits together

```
Electron (main.cjs)
 ├─ starts Kiln's backend:  java -jar server/kiln-studio-server.jar   (127.0.0.1:5191, KILN_STUDIO_PORT)
 ├─ starts the studio's Next.js server in Electron's own Node        (localhost:5190, PORT)
 └─ opens a window on it
page ──/api/*──▶ Next.js (src/app/api/[...path]) ──▶ kiln-studio-server ──FFM──▶ llama.cpp · stable-diffusion.cpp · acestep.cpp
```

The backend is `kiln-studio-server`, a module of the Kiln repository: JDK-only HTTP (`com.sun.net.httpserver`), replies
streamed as server-sent events, models kept in Kiln's `ModelPool`. The page talks only to the studio's own server, which
passes `/api/*` on as it is, so the browser app works the same from `npm start`. The backend is told the app's pid and
exits with it, so a model never stays on the GPU after the app has gone.

## Running it

Needs Node 22+, Java 25, and Kiln's native libraries (`native/build.sh` in the Kiln checkout).

```sh
npm install
npm run server:build   # builds kiln-studio-server in KILN_HOME (default ../kiln) into server/, with the native libraries
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
| `KILN_STUDIO_STUB` | kinds of work answered by a stub that loads nothing, as `image,song` (or `chat`): for trying the app without the GPU |
| `KILN_STUDIO_BUDGET_GB` | the pool's memory budget (24) |
| `KILN_STUDIO_IDLE_MINUTES` | unload a model idle this long (15) |
| `KILN_STUDIO_HOME` | where images and songs are kept (`~/.kiln-studio`, in `outputs/`) |
| `KILN_HOME`, `KILN_NATIVE`, `KILN_BACKEND` | for `npm run server:build`: the Kiln checkout, and which native libraries to ship |
| `KILN_STUDIO_JAR`, `KILN_LIBRARY_PATH`, `KILN_STUDIO_JAVA` | to run another backend jar, libraries or Java |
| `PORT`, `KILN_STUDIO_PORT` | the page's and the backend's ports (5190, 5191) |

`npm run package:linux` packs the app with electron-builder, with the backend jar, the native libraries and, after
`npm run server:jre`, a Java runtime as resources (in `server/`). `server:jre` jlinks one from the JDK at `JAVA_HOME`
with only the modules the jar uses (about 60 MB); the app runs it, `server/jre/bin/java`, and without it
`$JAVA_HOME/bin/java`, or `java` on the `PATH`.

## Releases

GitHub Actions builds what a release ships, from the Kiln commit in `kiln.ref` (bump it to take a newer Kiln):

- `kiln-backend.yml`, called by the two below once per platform: checks out Kiln, builds the engines the studio runs
  (`native/build.sh vulkan|metal llama sd acestep`, cached), the backend jar and its jlink'd Java runtime, and checks
  that the backend starts on it.
- `linux-build.yml`: a `.deb` and an `.rpm`, x64, Vulkan. They depend on the Vulkan loader and OpenMP; the GPU needs a
  Vulkan driver.
- `macos-signed.yml`: a `.dmg` and a `.zip` for Apple silicon and for Intel, Metal, signed with a Developer ID and
  notarized, in the `apple-signing` environment.

By hand (Actions, Run workflow) they keep what they built as the run's artifacts; on a published release (a `v*` tag)
they attach it to the release. Models are never bundled: the app finds them in the Hugging Face cache.

The workflows read the private Kiln repository with a deploy key: a read-only deploy key on `liberation-data/kiln`,
its private half in this repository's `KILN_DEPLOY_KEY` secret.

## Tests

```sh
npm test                                   # the page's helpers, the proxy, and how the app starts the backend
./gradlew :kiln-studio-server:test         # in the Kiln checkout: every route, over HTTP, with the engines stubbed
```

## License

Apache 2.0.
