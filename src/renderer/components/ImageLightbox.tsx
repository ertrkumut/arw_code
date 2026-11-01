import React, { useEffect } from 'react'
import { useApp } from '../store/appStore'

/** Full-size view of a pasted image. Click anywhere or press Esc to close.
 *  "Use in session" pastes the image into the terminal it was opened from. */
export function ImageLightbox() {
  const src = useApp(s => s.lightbox)
  const termId = useApp(s => s.lightboxTerm)
  const setLightbox = useApp(s => s.setLightbox)

  useEffect(() => {
    if (!src) return
    // Capture phase on window runs before the focused xterm sees the key, so Esc
    // closes the viewer instead of reaching the CLI (where it would cancel a task)
    // or restoring a maximized pane.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault(); e.stopPropagation()
      setLightbox(null)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [src, setLightbox])

  if (!src) return null

  // Same path as a Ctrl+V image paste: put the picture on the clipboard, then hand the
  // CLI its own image-paste key (Alt+V for Claude Code, raw Ctrl+V for the others).
  const reuse = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!termId) return
    const st = useApp.getState()
    const agent = st.projects.flatMap(p => p.terminals).find(t => t.id === termId)?.agent ?? 'claude'
    await window.arw.clipboardWriteImage(src)
    st.addImage(termId, src)
    window.arw.input(termId, agent === 'claude' ? '\x1bv' : '\x16')
    setLightbox(null)
    st.closeAssets()
    st.focusTerminal(termId)
  }

  return (
    <div className="lightbox" onClick={() => setLightbox(null)}>
      <img src={src} alt="Pasted image" draggable={false} />
      {termId && (
        <button className="lightbox-use" title="Paste this image into the terminal again" onClick={reuse}>
          Use in session
        </button>
      )}
    </div>
  )
}
