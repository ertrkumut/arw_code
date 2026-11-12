import React, { useMemo } from 'react'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import { linkifyPathsHtml, openPathLink } from './PathLinks'

marked.setOptions({ gfm: true, breaks: false })

/**
 * Agent markdown → sanitized HTML. Links open in the system browser, never in the app;
 * file / folder paths open their folder (relative ones against `cwd`).
 */
export function Markdown({ text, className = 'md', cwd }: { text: string; className?: string; cwd?: string }) {
  const html = useMemo(() => linkifyPathsHtml(DOMPurify.sanitize(marked.parse(text, { async: false }) as string)), [text])
  return (
    <div className={className}
      onClick={(e) => {
        const a = (e.target as HTMLElement).closest('a')
        if (!a) return
        e.preventDefault()
        const path = a.getAttribute('data-path')
        if (path) { void openPathLink(a, path, cwd); return }
        const href = a.getAttribute('href') ?? ''
        if (/^https?:\/\//i.test(href)) { window.arw.openExternal(href); return }
        // [ipc.ts](src/main/ipc.ts) / file:///D:/x — a link to a local file (a one-letter "scheme" is a drive).
        const local = /^file:/i.test(href) ? href.replace(/^file:\/\/\/?/i, '') : !/^([a-z][a-z0-9+.-]+:|#|$)/i.test(href) ? href : null
        if (local) { try { void openPathLink(a, decodeURIComponent(local.replace(/#L?\d+.*$/, '')), cwd) } catch { /* bad escape */ } }
      }}
      dangerouslySetInnerHTML={{ __html: html }} />
  )
}
