/**
 * Voice models, run in their own Electron utility process (see voiceService.ts) so they
 * use the native ONNX runtime on the CPU instead of the renderer's WebGPU/WASM build —
 * a fraction of the memory, and nothing on the GPU that Unity / Chrome want.
 *
 *   speech → text: Moonshine tiny (int8)        text → speech: Kokoro 82M (fp32)
 *
 * The process only exists while voice mode is on; killing it frees everything.
 *
 * in:  init { cacheDir, voice } · transcribe { id, audio } · speak { id, gen, text, voice } · cancel { gen }
 * out: progress { file, loaded, total } · ready · error { message, id? } · text { id, text }
 *      · audio { id, gen, audio, sampleRate }
 */
import { env, pipeline } from '@huggingface/transformers'
import { KokoroTTS } from 'kokoro-js'

const STT_MODEL = 'onnx-community/moonshine-tiny-ONNX'
const TTS_MODEL = 'onnx-community/Kokoro-82M-v1.0-ONNX'

const port = (process as any).parentPort as { on(ev: 'message', f: (e: { data: any }) => void): void; postMessage(m: unknown): void }
const post = (m: unknown) => port.postMessage(m)

let asr: any = null
let tts: KokoroTTS | null = null
/** Newest speech generation; older `speak` jobs were cancelled (the user cut Claude off). */
let current = 0

/** Runs jobs one at a time (one inference per model session). */
function serial() {
  let chain: Promise<unknown> = Promise.resolve()
  return (job: () => Promise<void>) => { chain = chain.then(job, job).catch(() => {}) }
}
const sttQueue = serial()
const ttsQueue = serial()

const onProgress = (p: any) => {
  if (p?.status === 'progress' && p.file) post({ type: 'progress', file: String(p.file), loaded: p.loaded ?? 0, total: p.total ?? 0 })
  if (p?.status === 'done' && p.file) post({ type: 'progress', file: String(p.file), loaded: 1, total: 1 })
}

async function init(cacheDir: string, voice: string) {
  env.allowLocalModels = false
  env.useFSCache = true
  env.cacheDir = cacheDir
  // Kokoro is much faster at full precision on the CPU than its int8 build (≈0.3× real time).
  const [a, t] = await Promise.all([
    pipeline('automatic-speech-recognition', STT_MODEL, { device: 'cpu', dtype: 'q8', progress_callback: onProgress }),
    KokoroTTS.from_pretrained(TTS_MODEL, { device: 'cpu', dtype: 'fp32', progress_callback: onProgress })
  ])
  asr = a; tts = t
  // Warm up so the first real turn isn't slow.
  await asr(new Float32Array(16000))
  await tts.generate('Ready.', { voice: voice as any })
}

port.on('message', ({ data: m }) => {
  switch (m?.type) {
    case 'init':
      init(m.cacheDir, m.voice).then(
        () => post({ type: 'ready' }),
        (err) => post({ type: 'error', message: `Couldn't load the voice models: ${err?.message ?? err}` }))
      return
    case 'transcribe':
      sttQueue(async () => {
        try {
          const out = await asr(m.audio)
          post({ type: 'text', id: m.id, text: String(out?.text ?? '').trim() })
        } catch (err: any) {
          post({ type: 'error', id: m.id, message: `Speech recognition failed: ${err?.message ?? err}` })
        }
      })
      return
    case 'cancel':
      current = Math.max(current, m.gen)
      return
    case 'speak':
      current = Math.max(current, m.gen)
      ttsQueue(async () => {
        if (m.gen < current || !tts) return
        try {
          const out = await tts.generate(m.text, { voice: m.voice, speed: m.speed ?? 1 })
          if (m.gen < current) return
          post({ type: 'audio', id: m.id, gen: m.gen, audio: out.audio, sampleRate: out.sampling_rate })
        } catch (err: any) {
          post({ type: 'error', id: m.id, message: `Speech failed: ${err?.message ?? err}` })
        }
      })
      return
  }
})
