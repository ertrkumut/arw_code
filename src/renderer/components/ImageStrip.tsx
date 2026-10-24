import React from 'react'
import { useApp } from '../store/appStore'

const NONE: string[] = []

/** Thumbnails of the images pasted into a terminal this session. Click one to see it
 *  full-size; hidden entirely until the first image arrives. */
export function ImageStrip({ termId }: { termId: string }) {
  const images = useApp(s => s.images[termId] ?? NONE)
  const removeImage = useApp(s => s.removeImage)
  const clearImages = useApp(s => s.clearImages)
  const setLightbox = useApp(s => s.setLightbox)
  if (images.length === 0) return null

  return (
    <div className="img-strip" onMouseDown={(e) => e.stopPropagation()}>
      {images.map((src, i) => (
        <span key={i} className="img-thumb" title="Click to enlarge" onClick={() => setLightbox(src)}>
          <img src={src} alt={`Pasted image ${i + 1}`} draggable={false} />
          <span className="img-thumb-x" title="Remove"
            onClick={(e) => { e.stopPropagation(); removeImage(termId, i) }}>✕</span>
        </span>
      ))}
      <button className="img-strip-clear" title="Remove all thumbnails" onClick={() => clearImages(termId)}>Clear</button>
    </div>
  )
}
