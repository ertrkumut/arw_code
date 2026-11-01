import React, { useEffect, useState } from 'react'
import { useApp } from '../store/appStore'

const NONE: string[] = []

/** Ctrl+I in a terminal: every image used in its Claude session, as a thumbnail grid.
 *  Click one to view it full-size. */
export function AssetsPanel() {
  const req = useApp(s => s.assetsFor)
  const pastedHere = useApp(s => (s.assetsFor && s.images[s.assetsFor.termId]) || NONE)
  const closeAssets = useApp(s => s.closeAssets)
  const setLightbox = useApp(s => s.setLightbox)
  // Images sent in the terminal's Claude conversation, read back from its transcript —
  // this also covers a resumed session's earlier turns. null = still loading.
  const [sent, setSent] = useState<string[] | null>(null)

  useEffect(() => {
    if (!req) return
    let alive = true
    setSent(null)
    window.arw.history.images(req.termId).then(i => { if (alive) setSent(i) }).catch(() => { if (alive) setSent(NONE) })
    return () => { alive = false }
  }, [req?.termId])

  // Esc or Ctrl+I again closes — unless the full-size viewer is up; it closes first.
  useEffect(() => {
    if (!req) return
    const onKey = (e: KeyboardEvent) => {
      const toggle = (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'i'
      if ((e.key !== 'Escape' && !toggle) || useApp.getState().lightbox) return
      e.preventDefault(); e.stopPropagation()
      closeAssets()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [req, closeAssets])

  if (!req) return null
  // The transcript is the full record once it exists; until then (other CLIs, or nothing
  // sent yet) fall back to what was pasted into the pane.
  const images = sent?.length ? sent : pastedHere

  return (
    <div className="modal-overlay" onMouseDown={closeAssets}>
      <div className="modal-card assets-card" onMouseDown={(e) => e.stopPropagation()}>
        <div className="assets-head">
          <div className="modal-title" style={{ margin: 0, flex: 1 }}>
            Images in this session{images.length ? ` · ${images.length}` : ''}
          </div>
          <span className="pane-btn" title="Close (Esc)" onClick={closeAssets}>✕</span>
        </div>
        <div className="assets-body">
          {images.length === 0 ? (
            <div className="assets-empty">{sent === null ? 'Loading…' : 'No images used in this session yet.'}</div>
          ) : (
            <div className="assets-grid" style={{ marginTop: 12 }}>
              {images.map((src, i) => (
                <button key={i} className="asset-tile" onClick={() => setLightbox(src, req.termId)}>
                  <span className="asset-img"><img src={src} alt="" draggable={false} /></span>
                  <span className="asset-name">Image {i + 1}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
