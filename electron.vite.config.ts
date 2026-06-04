import { resolve } from 'path'
import { cpSync } from 'fs'
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
    plugins: [react()],
    build: { rollupOptions: { input: { index: resolve('src/renderer/index.html') } } }
  }
})
