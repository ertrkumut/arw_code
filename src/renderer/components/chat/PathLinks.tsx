import React from 'react'
import { splitPaths, wholeCodePath } from '@shared/pathLinks'

/**
 * Paths written in a chat are links: clicking a file opens its folder with the file selected,
 * clicking a folder opens it. Relative paths resolve against the pane's folder.
 */
export async function openPathLink(el: HTMLElement, path: string, cwd?: string) {
  const r = await window.arw.openPathFolder(path, cwd)
  if (r !== 'missing') return
  // Say so right where the user clicked.
  el.classList.add('missing')
  const was = el.title
  el.title = `Not found: ${path}`
  window.setTimeout(() => { el.classList.remove('missing'); el.title = was }, 1600)
}

const titleOf = (path: string) => `Open folder — ${path}`

/** Linkify paths inside already-sanitized HTML (Markdown output). Skips existing links. */
export function linkifyPathsHtml(html: string): string {
  if (!/[\\/]/.test(html)) return html
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html')
  const body = doc.body
  const link = (text: string, path: string) => {
    const a = doc.createElement('a')
    a.className = 'ch-path'
    a.setAttribute('href', '#')
    a.setAttribute('data-path', path)
    a.setAttribute('title', titleOf(path))
    a.textContent = text
    return a
  }
  // `C:\Program Files\x.exe` — a whole inline-code path, spaces allowed.
  for (const code of Array.from(body.querySelectorAll('code'))) {
    if (code.closest('a') || code.parentElement?.tagName === 'PRE') continue
    const p = wholeCodePath(code.textContent ?? '')
    if (!p) continue
    const a = link('', p)
    code.replaceWith(a)
    a.appendChild(code)
  }
  const walker = doc.createTreeWalker(body, NodeFilter.SHOW_TEXT)
  const nodes: Text[] = []
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const t = n as Text
    if (t.parentElement?.closest('a') || !/[\\/]/.test(t.data)) continue
    nodes.push(t)
  }
  for (const t of nodes) {
    const parts = splitPaths(t.data)
    if (!parts.some(p => 'path' in p)) continue
    const frag = doc.createDocumentFragment()
    for (const p of parts) frag.appendChild('path' in p ? link(p.text, p.path) : doc.createTextNode(p.text))
    t.replaceWith(frag)
  }
  return body.innerHTML
}

/** Plain text (a typed prompt, command output) with its paths as links. */
export function PathText({ text, cwd }: { text: string; cwd?: string }) {
  if (!/[\\/]/.test(text)) return <>{text}</>
  return <>{splitPaths(text).map((p, i) => 'path' in p
    ? <a key={i} href="#" className="ch-path" title={titleOf(p.path)}
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); void openPathLink(e.currentTarget, p.path, cwd) }}>{p.text}</a>
    : <React.Fragment key={i}>{p.text}</React.Fragment>)}</>
}
