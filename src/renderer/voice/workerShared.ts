import { env } from '@huggingface/transformers'

/** Messages a voice worker posts back to the page. */
export type WorkerOut =
  | { type: 'progress'; file: string; loaded: number; total: number }
  | { type: 'ready'; device: 'webgpu' | 'wasm' }
  | { type: 'error'; message: string; id?: number }

/**
 * Point transformers.js at the ONNX runtime files ARW ships (no CDN) and keep the models
 * in the browser cache, so after the first download voice mode works offline.
 */
export function setupEnv(base: string) {
  env.allowLocalModels = false
  env.useBrowserCache = true
  const wasm = env.backends.onnx.wasm
  if (wasm) wasm.wasmPaths = `${base}tf/`
}

/** WebGPU is much faster; fall back to WASM (CPU) when the GPU isn't usable. */
export async function pickDevice(): Promise<'webgpu' | 'wasm'> {
  try {
    const gpu = (navigator as any).gpu
    if (gpu && await gpu.requestAdapter()) return 'webgpu'
  } catch { /* no WebGPU */ }
  return 'wasm'
}

export const post = (m: WorkerOut, transfer: Transferable[] = []) => (self as any).postMessage(m, transfer)

/** transformers.js download progress → our message (one per file). */
export const onProgress = (p: any) => {
  if (p?.status === 'progress' && p.file) post({ type: 'progress', file: String(p.file), loaded: p.loaded ?? 0, total: p.total ?? 0 })
  if (p?.status === 'done' && p.file) post({ type: 'progress', file: String(p.file), loaded: 1, total: 1 })
}

/** Runs jobs one at a time (a model session can't run two inferences at once). */
export function serial() {
  let chain: Promise<unknown> = Promise.resolve()
  return <T>(job: () => Promise<T>): Promise<T> => {
    const next = chain.then(job, job)
    chain = next.catch(() => {})
    return next
  }
}
