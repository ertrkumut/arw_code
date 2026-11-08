import React, { useEffect, useRef, useState } from 'react'
import { baseName } from '../../ide/paths'

const ZOOM_MIN = 0.05
const ZOOM_MAX = 32
const clamp = (z: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z))
const fmtSize = (n: number) => n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(2)} MB`

/**
 * Image tab for the IDE window. Opens fitted to the pane (never upscaled),
 * Ctrl+wheel zooms around the cursor, drag pans, double-click toggles 1:1 / fit.
 * The checkerboard shows through transparent pixels like Rider's image viewer.
 */
export function ImageViewer({ path, dataUrl, size }: { path: string; dataUrl: string; size: number }) {
  const hostRef = useRef<HTMLDivElement>(null)
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null)
  const [zoom, setZoom] = useState(1)
  const [fit, setFit] = useState(true)          // follow the pane size until the user zooms
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(null)

  const fitZoom = () => {
    const el = hostRef.current
    if (!el || !dims) return 1
    const pad = 32
    return clamp(Math.min(1, (el.clientWidth - pad) / dims.w, (el.clientHeight - pad) / dims.h))
  }

  // New file → back to fitted.
  useEffect(() => { setDims(null); setFit(true); setPan({ x: 0, y: 0 }) }, [dataUrl])

  // While fitted, track the pane size.
  useEffect(() => {
    if (!fit || !dims) return
    const el = hostRef.current
    if (!el) return
    const apply = () => setZoom(fitZoom())
    apply()
    const ro = new ResizeObserver(apply)
    ro.observe(el)
    return () => ro.disconnect()
  }, [fit, dims])

  // Native, non-passive wheel listener so preventDefault actually stops page scroll.
  useEffect(() => {
    const el = hostRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return
      e.preventDefault(); e.stopPropagation()
      setFit(false)
      setZoom(z => {
        const next = clamp(z * (e.deltaY < 0 ? 1.15 : 1 / 1.15))
        // Keep the pixel under the cursor fixed while zooming.
        const r = el.getBoundingClientRect()
        const cx = e.clientX - r.left - r.width / 2
        const cy = e.clientY - r.top - r.height / 2
        const k = next / z
        setPan(p => ({ x: cx - (cx - p.x) * k, y: cy - (cy - p.y) * k }))
        return next
      })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  const onMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return
    drag.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y }
    const move = (ev: MouseEvent) => {
      const d = drag.current; if (!d) return
      setPan({ x: d.px + ev.clientX - d.x, y: d.py + ev.clientY - d.y })
    }
    const up = () => { drag.current = null; window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up) }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  const toggle = () => {
    if (fit) { setFit(false); setZoom(1); setPan({ x: 0, y: 0 }) }
    else { setFit(true); setPan({ x: 0, y: 0 }) }
  }

  return (
    <div className="imgv">
      <div className="imgv-canvas" ref={hostRef} onMouseDown={onMouseDown} onDoubleClick={toggle}
        style={{ cursor: drag.current ? 'grabbing' : 'grab' }}>
        <img src={dataUrl} alt={baseName(path)} draggable={false}
          onLoad={(e) => setDims({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            imageRendering: zoom >= 3 ? 'pixelated' : 'auto',
            visibility: dims ? 'visible' : 'hidden'
          }} />
      </div>
      <div className="imgv-bar">
        <span>{dims ? `${dims.w} × ${dims.h}` : '…'}</span>
        <span className="imgv-sep" />
        <span>{fmtSize(size)}</span>
        <span className="imgv-sep" />
        <span>{Math.round(zoom * 100)}%{fit ? ' · fit' : ''}</span>
        <span className="imgv-spacer" />
        <button className="imgv-btn" onClick={() => { setFit(false); setZoom(1); setPan({ x: 0, y: 0 }) }}>1:1</button>
        <button className="imgv-btn" onClick={() => { setFit(true); setPan({ x: 0, y: 0 }) }}>Fit</button>
        <span className="imgv-hint">Ctrl+wheel zoom · drag to pan · double-click to toggle</span>
      </div>
    </div>
  )
}
