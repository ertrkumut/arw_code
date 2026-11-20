import { resolve } from 'path'
import { cpSync, readFileSync, existsSync, createReadStream } from 'fs'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

/**
 * Copies the raw hook-script (arw-hook.cjs) into the main build output.
 * Runs on every main build — including `electron-vite dev`, which empties
 * out/main on each rebuild — so the hook path referenced by hookInstaller
 * always exists. Mirrors scripts/copy-hook.cjs (kept for the prod build).
 */
function copyHookScript() {
  return {
    name: 'copy-hook-script',
    writeBundle() {
      cpSync(resolve('src/main/hook-script'), resolve('out/main/hook-script'), { recursive: true })
    }
  }
}

/**
 * Voice mode runtime files, served at ./voice/… next to index.html (dev server + build):
 * the Silero VAD model + worklet with the ONNX runtime vad-web was built against, and the
 * ONNX runtime transformers.js (Whisper / Kokoro) loads. Models themselves download at
 * first use. Keeps everything off the CDN.
 */
function voiceAssets() {
  const vadDist = resolve('node_modules/@ricky0123/vad-web/dist')
  const nestedOrt = resolve('node_modules/@ricky0123/vad-web/node_modules/onnxruntime-web/dist')
  const vadOrt = existsSync(nestedOrt) ? nestedOrt : resolve('node_modules/onnxruntime-web/dist')
  const tfDist = resolve('node_modules/@huggingface/transformers/dist')
  const files: Record<string, string> = {
    'voice/vad/vad.worklet.bundle.min.js': `${vadDist}/vad.worklet.bundle.min.js`,
    'voice/vad/silero_vad_v5.onnx': `${vadDist}/silero_vad_v5.onnx`,
    'voice/vad/ort-wasm-simd-threaded.mjs': `${vadOrt}/ort-wasm-simd-threaded.mjs`,
    'voice/vad/ort-wasm-simd-threaded.wasm': `${vadOrt}/ort-wasm-simd-threaded.wasm`,
    'voice/tf/ort-wasm-simd-threaded.jsep.mjs': `${tfDist}/ort-wasm-simd-threaded.jsep.mjs`,
    'voice/tf/ort-wasm-simd-threaded.jsep.wasm': `${tfDist}/ort-wasm-simd-threaded.jsep.wasm`
  }
  const type = (f: string) => f.endsWith('.wasm') ? 'application/wasm' : /\.m?js$/.test(f) ? 'text/javascript' : 'application/octet-stream'
  return {
    name: 'voice-assets',
    configureServer(server: any) {
      server.middlewares.use((req: any, res: any, next: () => void) => {
        const path = decodeURIComponent((req.url ?? '').split('?')[0]).replace(/^\//, '')
        const src = files[path]
        if (!src) return next()
        res.setHeader('Content-Type', type(path))
        createReadStream(src).pipe(res)
      })
    },
    generateBundle(this: any) {
      for (const [fileName, src] of Object.entries(files)) this.emitFile({ type: 'asset', fileName, source: readFileSync(src) })
    }
  }
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin(), copyHookScript()],
    resolve: { alias: { '@shared': resolve('src/shared') } },
    build: { rollupOptions: { input: { index: resolve('src/main/index.ts') } } }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: { '@shared': resolve('src/shared') } },
    build: { rollupOptions: { input: { index: resolve('src/preload/index.ts') } } }
  },
  renderer: {
    root: 'src/renderer',
    resolve: { alias: { '@shared': resolve('src/shared') } },
    plugins: [react(), voiceAssets()],
    // Voice workers import ONNX runtime modules dynamically, which needs ES-module workers.
    worker: { format: 'es' },
    // Shown in the title bar; read from package.json so `npm version` is the only place to bump it.
    define: { __APP_VERSION__: JSON.stringify(JSON.parse(readFileSync(resolve('package.json'), 'utf8')).version) },
    build: { rollupOptions: { input: { index: resolve('src/renderer/index.html') } } }
  }
})
