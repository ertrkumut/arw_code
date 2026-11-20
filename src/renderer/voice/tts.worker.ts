/// <reference lib="webworker" />
import { KokoroTTS } from 'kokoro-js'
import { setupEnv, pickDevice, post, onProgress, serial } from './workerShared'

/**
 * Text → speech with Kokoro (82M), running locally in this worker.
 *   in:  { type: 'init', base } · { type: 'speak', id, gen, text, voice, speed } · { type: 'cancel', gen }
 *   out: progress / ready / error · { type: 'audio', id, gen, audio: Float32Array, sampleRate }
 * Jobs from an older `gen` (the user interrupted) are dropped without synthesizing.
 */

const MODEL = 'onnx-community/Kokoro-82M-v1.0-ONNX'
let tts: KokoroTTS | null = null
let current = 0
const run = serial()

async function load(device: 'webgpu' | 'wasm') {
  // Kokoro needs full precision on the GPU; int8 is the fast CPU build.
  return KokoroTTS.from_pretrained(MODEL, { dtype: device === 'webgpu' ? 'fp32' : 'q8', device, progress_callback: onProgress })
}

self.onmessage = async (e: MessageEvent) => {
  const m = e.data
  if (m.type === 'init') {
    try {
      setupEnv(m.base)
      let device = await pickDevice()
      try { tts = await load(device) } catch (err) {
        if (device !== 'webgpu') throw err
        console.warn('[voice] Kokoro on WebGPU failed, using CPU', err)
        device = 'wasm'
        tts = await load(device)
      }
      await tts.generate('Ready.', { voice: m.voice ?? 'af_heart' })     // warm-up (also caches the voice)
      post({ type: 'ready', device })
    } catch (err: any) {
      post({ type: 'error', message: `Couldn't load the voice: ${err?.message ?? err}` })
    }
    return
  }
  if (m.type === 'cancel') { current = Math.max(current, m.gen); return }
  if (m.type === 'speak') {
    current = Math.max(current, m.gen)
    await run(async () => {
      if (m.gen < current || !tts) return
      try {
        const out = await tts.generate(m.text, { voice: m.voice, speed: m.speed ?? 1 })
        if (m.gen < current) return
        const audio = out.audio as Float32Array
        ;(self as any).postMessage({ type: 'audio', id: m.id, gen: m.gen, audio, sampleRate: out.sampling_rate }, [audio.buffer])
      } catch (err: any) {
        post({ type: 'error', id: m.id, message: `Speech failed: ${err?.message ?? err}` })
      }
    })
  }
}
