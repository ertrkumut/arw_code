import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
  resolve: { alias: { '@shared': resolve('src/shared'), '@main': resolve('src/main') } },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] }
})
