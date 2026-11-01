import React, { useMemo } from 'react'
import { marked } from 'marked'
import DOMPurify from 'dompurify'

marked.setOptions({ gfm: true, breaks: false })

/** Claude's markdown → sanitized HTML. Links open in the system browser, never in the app. */
export function Markdown({ text, className = 'md' }: { text: string; className?: string }) {
  const html = useMemo(() => DOMPurify.sanitize(marked.parse(text, { async: false }) as string), [text])
  return (
    <div className={className}
      onClick={(e) => {
        const a = (e.target as HTMLElement).closest('a')
        if (!a) return
        e.preventDefault()
        const href = a.getAttribute('href') ?? ''
        if (/^https?:\/\//i.test(href)) window.arw.openExternal(href)
      }}
      dangerouslySetInnerHTML={{ __html: html }} />
  )
}
