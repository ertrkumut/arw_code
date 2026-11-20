/// <reference lib="webworker" />
import { pipeline } from '@huggingface/transformers'
import { setupEnv, pickDevice, post, onProgress, serial } from './workerShared'

/**
 * Speech → text with Whisper (base.en), running locally in this worker.
 *   in:  { type: 'init', base } · { type: 'transcribe', id, audio: Float32Array (16 kHz mono) }
 *   out: progress / ready / error · { type: 'text', id, text }
 */

const MODEL = 'onnx-community/whisper-base.en'
let asr: any = null
const run = serial()

async function load(device: 'webgpu' | 'wasm') {
  return pipeline('automatic-speech-recognition', MODEL, {
    device,
    // The small GPU-friendly mix from the transformers.js Whisper WebGPU demo; CPU gets int8.
    dtype: device === 'webgpu' ? { encoder_model: 'fp32', decoder_model_merged: 'q4' } as any : 'q8',
    progress_callback: onProgress
  })
}

self.onmessage = async (e: MessageEvent) => {
  const m = e.data
  if (m.type === 'init') {
    try {
      setupEnv(m.base)
      let device = await pickDevice()
      try { asr = await load(device) } catch (err) {
        if (device !== 'webgpu') throw err
        console.warn('[voice] Whisper on WebGPU failed, using CPU', err)
        device = 'wasm'
        asr = await load(device)
      }
      // Warm up so the first real sentence isn't slow.
      await asr(new Float32Array(16000))
      post({ type: 'ready', device })
    } catch (err: any) {
      post({ type: 'error', message: `Couldn't load speech recognition: ${err?.message ?? err}` })
    }
    return
  }
  if (m.type === 'transcribe') {
    await run(async () => {
      try {
        const out = await asr(m.audio)
        const text = (Array.isArray(out) ? out[0]?.text : out?.text) ?? ''
        ;(self as any).postMessage({ type: 'text', id: m.id, text: String(text).trim() })
      } catch (err: any) {
        post({ type: 'error', id: m.id, message: `Speech recognition failed: ${err?.message ?? err}` })
      }
    })
  }
}
