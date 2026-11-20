# Prompt: add a voice conversation mode to an AI chat

Copy everything below the line into Claude Code (or another coding agent) running in your project.

---

I want to add a **voice conversation mode** to the AI chat in this product. When it's on, the user talks out loud and the assistant answers out loud, like a real call, not a dictation tool. It has to be **free and run locally** (no paid speech APIs), sound **natural** (not robotic), and let the user **interrupt the assistant mid-sentence** just by talking.

Before writing code, read how our chat currently works: how a prompt is sent, how the assistant's reply streams back (token deltas or whole messages), how a turn is stopped or interrupted, and how history is rendered. Then fit the design below into it. It is written for an **Electron** app (mic in the renderer, models in a Node process). If we're a plain web app with no Node side, tell me first: the fallback is to run both models in **one** Web Worker with transformers.js on WebGPU, which works but costs a lot more memory.

## Stack (all local, all free)

- **Speech detection (renderer):** Silero VAD through `@ricky0123/vad-web` (`MicVAD`, model `v5`). It detects when the user starts and stops talking and hands over 16 kHz Float32 audio for each utterance.
- **Speech to text (Node):** Moonshine tiny, `onnx-community/moonshine-tiny-ONNX`, dtype `'q8'`, through `@huggingface/transformers` **v3** (`pipeline('automatic-speech-recognition', …, { device: 'cpu' })`).
- **Text to speech (Node):** Kokoro 82M through `kokoro-js` (`onnx-community/Kokoro-82M-v1.0-ONNX`).
  - Use dtype `'fp32'` with `device: 'cpu'`. On the native CPU runtime this is about 3× faster than `'q8'`.
  - It outputs 24 kHz audio.
  - Good voices: `am_michael`, `af_heart`, `bm_george`, `bf_emma`.
- Both run on **onnxruntime-node** (native CPU). Use transformers **v3**, not v4, because `kokoro-js` depends on v3.

Why this setup: we measured the alternatives on a desktop with a decent GPU.

```
                                            RAM with voice on   STT      TTS
WebGPU in the renderer, two workers         ~4 GB               ~0.9 s   ~1.1 s / sentence
WebGPU, one worker, Moonshine on WASM       ~2.2 GB             ~0.7 s   ~1.1 s / sentence
native onnxruntime-node, separate process   ~1.4 GB (app incl.) ~0.3 s   ~0.3× real time
```

WebGPU/WASM in the browser costs roughly 1 GB of fixed runtime overhead per worker on top of the models. The native runtime avoids that and keeps the GPU free for other apps.

Things that did **not** work, so don't try them:
- DirectML: Kokoro fails on its ConvTranspose op.
- Kokoro `q8` or WASM: too slow for a conversation.
- fp16 on WebGPU: needs the `shader-f16` feature, which many GPUs don't expose.

Reference numbers:
- First-time model download is about 400 MB.
- After that, voice mode starts in about 3 s.
- STT takes about 0.2–0.3 s per utterance.
- The first sound plays about 1 s after the reply starts streaming.
- Turning voice off frees everything.

## Architecture

1. **Model process.** Use an Electron `utilityProcess.fork()` running a small host script. It's started when voice turns on and **killed when voice turns off**, the window closes, or the app quits.
   - The host loads both models in parallel. Set `env.allowLocalModels = false`, `env.useFSCache = true`, and `env.cacheDir = <userData>/voice-models`.
   - It warms both models up once (STT on 1 s of silence, TTS on a short word).
   - It reports download progress (transformers' `progress_callback`) so the UI can show "Downloading voice models (one time) · 42%".
   - Messages in: `init`, `transcribe {id, audio}`, `speak {id, gen, text, voice}`, `cancel {gen}`.
   - Messages out: `progress`, `ready`, `error`, `text {id, text}`, `audio {id, gen, audio, sampleRate}`.
   - Run STT and TTS each **one job at a time** with a promise chain.
   - Main relays messages between the window that started voice and the host. Float32Arrays go through IPC / `parentPort` as-is.
2. **Engine in the renderer** (one instance; only one chat at a time can be in voice mode) wires up:
   - mic → VAD → (user stops talking) → `transcribe` → send the prompt to the assistant
   - the assistant's streamed reply → **sentence chunker** → `speak` → audio queue → speakers through a `GainNode` (for volume)
3. **Streaming speech.** Don't wait for the full reply. Feed text deltas into a chunker that sends each sentence to TTS the moment it's complete, and play the sentences in order as their audio arrives. That gets the first sound out within about a second. If the backend doesn't stream, speak the whole message when it arrives.
4. **Barge-in (interrupting).**
   - Use VAD's `onSpeechRealStart`, not `onSpeechStart`, so short blips don't count.
   - If the assistant is speaking or has speech queued when the user starts talking:
     - Stop the current audio source and clear the queue.
     - Bump a "generation" counter and send `cancel {gen}` to the model process. It skips queued jobs from older generations, and the renderer ignores any old-generation audio still in flight.
     - Interrupt the assistant's turn if it's still generating, and ignore any more text from that turn.
     - Record what the user actually heard: the sentences that finished, plus the part of the current sentence that played, estimated from playback time divided by duration.
5. **Telling the model it's a voice conversation.** Put a hidden instruction block in front of each spoken prompt (for example wrapped in `<voice-mode>…</voice-mode>`).
   - Strip that block again everywhere the user's message is shown, including history reloaded from storage.
   - If the user just interrupted, add: *"They interrupted you mid-reply; they heard you up to: "…last ~280 chars…". Anything after that was not heard. React to what they say now."*
   - Instruction text that worked well:
     > Voice conversation: the user is talking to you out loud and hears your replies through text-to-speech. Talk like a sharp, friendly senior engineer on a call: natural spoken English, contractions, a bit of personality. Have a real discussion: think out loud, weigh options and trade-offs, say what you would pick and why, ask questions back, and push back when you disagree. Keep each turn short (a few sentences) so it stays a back-and-forth, unless they ask you to go deeper. Never read code, file paths, tables or bullet lists aloud: describe them in plain words. If code or a list really helps, put it in a fenced code block; it is shown on screen and not spoken. No markdown formatting, headings or emoji in what you say. You can still use your tools and do the work when they ask; tell them briefly what you are about to do. Their words come from speech recognition, so read past small transcription mistakes.

## Sentence chunker (pure function or class, with unit tests)

Methods: `push(delta) → sentences[]`, `flush() → sentences[]`, `reset()`. Rules:

- A sentence ends at `. ! ? …` (optionally followed by a closing quote or bracket) **followed by whitespace**. Emit finished sentences right away and keep the unfinished tail.
- A completed line also ends a chunk.
- **Skip fenced code blocks** (track ``` / ~~~ across deltas), table rows (lines starting with `|`) and horizontal rules. While the start of a line could still turn into a fence, table row or rule, wait for the rest of the line.
- Strip heading, quote and list markers before splitting, so "1." isn't read as its own sentence.
- Make the text speakable:
  - `[text](url)` → text
  - inline code → its content
  - bare URLs → "a link"
  - file paths → just the file name
  - `->` / `→` → "to"
  - drop bold/italic markers and emoji
  - collapse whitespace
  - drop chunks with no letters or digits
- If a run gets past about 260 characters with no sentence end, cut it at the last comma, semicolon or dash so speech can start.
- The output must not depend on how the text was split into deltas. Test with chunk sizes 1, 7 and the whole text.

Also add a filter for speech-recognition noise output: empty text, text that's only `[BLANK_AUDIO]` or `(wind blowing)`, or just "you". Never send those as prompts.

## Speech detection settings

- Normal: `positiveSpeechThreshold 0.5`, `negativeSpeechThreshold 0.35`, `redemptionMs 900` (the silence that ends the user's turn), `minSpeechMs 300`, `preSpeechPadMs 400`.
- **While the assistant is speaking**, switch with `vad.setOptions()` to `0.8 / 0.5` so its own voice from the speakers doesn't trigger a barge-in, then switch back afterwards.
- Keep the browser's `echoCancellation`, `noiseSuppression` and `autoGainControl` on. vad-web's default `getUserMedia` constraints already do this.
- Headphones remove echo entirely. Mention that in the UI or docs.

## Bundling and packaging (this is where it usually breaks)

- **VAD files in the renderer.** Serve them from your own app, not a CDN: `vad.worklet.bundle.min.js`, `silero_vad_v5.onnx`, and the `ort-wasm-simd-threaded.{mjs,wasm}` from the **onnxruntime-web version vad-web depends on** (possibly a nested copy under vad-web's node_modules). Point `baseAssetPath` / `onnxWASMBasePath` at them. Load vad-web with a dynamic `import()` when voice is first turned on.
- **Bundle transformers.js and kokoro-js into the host script.** In electron-vite, keep them in devDependencies so they get bundled, and add the host as a second main-process entry.
  - Keep `onnxruntime-node` **and** `onnxruntime-common` **external**. If onnxruntime-common gets bundled, you end up with two copies and "no available backend" errors.
  - Add `onnxruntime-node` (exact version transformers uses, e.g. `1.21.0`) to `dependencies`.
- **`sharp`:** transformers' Node build imports it at load time for image models. Alias it to a stub whose default export is a function that throws. That avoids shipping about 20 MB of native image code you never use.
- **Kokoro voice files:** kokoro-js reads `../voices/<id>.bin` relative to its own file. Once bundled, that path is next to your output folder, so copy the voice `.bin` files you offer there at build time.
- **electron-builder:**
  - `asarUnpack: ["node_modules/onnxruntime-node/**"]`, because the `.node` binding and its DLLs must be on disk.
  - Strip the other platforms' binaries per target, for example on Windows `!node_modules/onnxruntime-node/bin/napi-v3/{linux,darwin,win32/arm64}/**`.
  - If you set per-platform `files`, **repeat your include pattern** (e.g. `out/**/*`) in that list. Otherwise electron-builder falls back to `**/*` and ships your source and tests.
  - Expect the installer to grow by about 20 MB.
- Mic permission is granted by default unless you set a permission handler.

## UI (in the chat input bar)

- **Voice toggle** (waveform icon). Turning voice on in one chat turns it off in any other. Closing the chat turns it off.
- When it's on:
  - **Mic mute** (`vad.pause()` / `vad.start()`)
  - **Volume slider** for the assistant's voice (GainNode, saved in localStorage)
  - **Voice picker** (saved)
- A **status line** above the input:
  - Downloading voice models · N% (with a progress bar)
  - Listening
  - Hearing you…
  - Got it… (transcribing)
  - Thinking…
  - Speaking · just talk to interrupt (with a Skip button)
  - Mic muted
  - Errors, with a Dismiss button. A missing mic should show "check your OS microphone privacy settings".
- The existing Stop button / Esc should also silence the voice.
- The user's spoken words appear in the chat as a normal user message (without the hidden instruction block).

## Done means

- Unit tests for the chunker, the prompt wrap/strip, and the noise filter pass.
- In the running app, turning voice on downloads the models once, then reaches "Listening". After a restart it starts in a few seconds without downloading again.
- Speaking a question gets a spoken, conversational answer that starts within about a second of the reply streaming.
- Talking over the assistant stops it right away, and its next answer reacts to the interruption.
- The installed/packaged app works, not just the dev server: the model process starts from inside the asar, loads the unpacked native runtime and the copied voice files.
- Memory goes back to the normal baseline when voice is turned off.

Explain your plan briefly first, then build it.
