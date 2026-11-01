import React from 'react'
import { useApp } from '../store/appStore'

const NONE: string[] = []

/** Thumbnails of the images pasted for the prompt being typed. Click one to see it
 *  full-size; hidden until an image arrives and again once the prompt is sent
 *  (Ctrl+I lists everything from the session). */
export function ImageStrip({ termId }: { termId: string }) {
  const images = useApp(s => s.pendingImages[termId] ?? NONE)
  const removePendingImage = useApp(s => s.removePendingImage)
  const setLightbox = useApp(s => s.setLightbox)
  if (images.length === 0) return null

  return (
    <div className="img-strip" onMouseDown={(e) => e.stopPropagation()}>
      {images.map((src, i) => (
        <span key={i} className="img-thumb" title="Click to enlarge" onClick={() => setLightbox(src, termId)}>
          <img src={src} alt={`Pasted image ${i + 1}`} draggable={false} />
          <span className="img-thumb-x" title="Remove"
            onClick={(e) => { e.stopPropagation(); removePendingImage(termId, i) }}>✕</span>
        </span>
      ))}
    </div>
  )
}
