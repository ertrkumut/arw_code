import type { ArwApi } from '../preload/index'
declare global {
  interface Window { arw: ArwApi }
  /** package.json version, injected at build time (electron.vite.config.ts). */
  const __APP_VERSION__: string
}
