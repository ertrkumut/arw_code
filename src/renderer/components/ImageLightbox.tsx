import React, { useEffect } from 'react'
import { useApp } from '../store/appStore'

/** Full-size view of a pasted image. Click anywhere or press Esc to close. */
export function ImageLightbox() {
  const src = useApp(s => s.lightbox)
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
  return (
    <div className="lightbox" onClick={() => setLightbox(null)}>
      <img src={src} alt="Pasted image" draggable={false} />
    </div>
  )
}
