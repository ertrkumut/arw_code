/// <reference types="vite/client" />
// The ESM entry we import has the same API as the package root.
declare module 'monaco-editor/esm/vs/editor/edcore.main' {
  export * from 'monaco-editor'
}
