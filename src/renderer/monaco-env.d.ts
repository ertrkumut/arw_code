/// <reference types="vite/client" />
// The ESM entry we import has the same API as the package root.
declare module 'monaco-editor/esm/vs/editor/edcore.main' {
  export * from 'monaco-editor'
}

// dompurify 3.1.6 ships no typings; we only call sanitize().
declare module 'dompurify' {
  const DOMPurify: { sanitize(html: string): string }
  export default DOMPurify
}
