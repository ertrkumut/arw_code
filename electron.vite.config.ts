import { resolve } from 'path'
import { cpSync, readFileSync, existsSync, createReadStream, mkdirSync } from 'fs'
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
 * Voice mode's speech-detection files, served at ./voice/vad/… next to index.html (dev
 * server + build): the Silero VAD model + worklet and the ONNX runtime vad-web was built
 * against. Keeps everything off the CDN. (Speech models run in main/voiceHost.ts.)
 */
function voiceAssets() {
  const vadDist = resolve('node_modules/@ricky0123/vad-web/dist')
  const nestedOrt = resolve('node_modules/@ricky0123/vad-web/node_modules/onnxruntime-web/dist')
  const vadOrt = existsSync(nestedOrt) ? nestedOrt : resolve('node_modules/onnxruntime-web/dist')
  const files: Record<string, string> = {
    'voice/vad/vad.worklet.bundle.min.js': `${vadDist}/vad.worklet.bundle.min.js`,
    'voice/vad/silero_vad_v5.onnx': `${vadDist}/silero_vad_v5.onnx`,
    'voice/vad/ort-wasm-simd-threaded.mjs': `${vadOrt}/ort-wasm-simd-threaded.mjs`,
    'voice/vad/ort-wasm-simd-threaded.wasm': `${vadOrt}/ort-wasm-simd-threaded.wasm`
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

/** Kokoro voices the picker offers (renderer/store/voiceStore.ts). */
const KOKORO_VOICES = ['bm_george', 'bm_fable', 'am_michael', 'am_puck', 'af_heart', 'af_bella', 'bf_emma']

/**
 * kokoro-js reads voice styles from `../voices/<id>.bin` next to its own file; bundled into
 * out/main/voiceHost.js that's out/voices, so copy them there.
 */
function copyKokoroVoices() {
  return {
    name: 'copy-kokoro-voices',
    writeBundle() {
      mkdirSync(resolve('out/voices'), { recursive: true })
      for (const v of KOKORO_VOICES) cpSync(resolve(`node_modules/kokoro-js/voices/${v}.bin`), resolve(`out/voices/${v}.bin`))
    }
  }
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin(), copyHookScript(), copyKokoroVoices()],
    // Voice models (voiceHost) bundle transformers.js + kokoro-js; the native ONNX runtime
    // stays external (one copy of onnxruntime-common, shared with onnxruntime-node).
    resolve: { alias: { '@shared': resolve('src/shared'), sharp: resolve('src/main/sharpStub.ts') } },
    build: { rollupOptions: {
      input: { index: resolve('src/main/index.ts'), voiceHost: resolve('src/main/voiceHost.ts') },
      external: ['onnxruntime-node', 'onnxruntime-common']
    } }
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
    // Shown in the title bar; read from package.json so `npm version` is the only place to bump it.
    define: { __APP_VERSION__: JSON.stringify(JSON.parse(readFileSync(resolve('package.json'), 'utf8')).version) },
    build: { rollupOptions: { input: { index: resolve('src/renderer/index.html') } } }
  }
})
