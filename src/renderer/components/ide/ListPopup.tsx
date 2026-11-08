import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { fuzzyName } from '@shared/csharp'
import { useNav, type PopupItem } from '../../store/navStore'
import { SymbolIcon } from './SymbolIcon'
import { getEditor } from '../../ide/context'

interface Props {
  title: string
  items: PopupItem[]
  anchor?: { x: number; y: number }
  filter?: boolean
  footer?: { label: string; onClick: () => void }
  initialIndex?: number
  releaseCtrlPicks?: boolean
  empty?: string
}

/** Highlight `mark` (or the filter hit) inside a label. */
export function Marked({ text, mark }: { text: string; mark?: [number, number] }) {
  if (!mark || mark[1] <= mark[0]) return <>{text}</>
  return <>{text.slice(0, mark[0])}<b className="pl-mark">{text.slice(mark[0], mark[1])}</b>{text.slice(mark[1])}</>
}

/**
 * Rider-style popup list (Choose Declaration, Show Usages, File Structure, Recent Files…):
 * type to filter (CamelHumps), ↑/↓ to move, Enter to pick, Esc to close.
 */
export function ListPopup({ title, items, anchor, filter, footer, initialIndex = 0, releaseCtrlPicks, empty }: Props) {
  const close = () => { useNav.getState().close(); getEditor()?.focus() }
  const [query, setQuery] = useState('')
  const [idx, setIdx] = useState(initialIndex)
  const listRef = useRef<HTMLDivElement>(null)
  const cardRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)

  const shown = useMemo(() => {
    if (!query) return items
    const scored = items.filter(i => !i.header).map(i => ({ i, s: Math.max(fuzzyName(query, i.label), i.detail ? fuzzyName(query, i.detail) - 50 : -1) }))
    return scored.filter(x => x.s >= 0).sort((a, b) => b.s - a.s).map(x => x.i)
  }, [items, query])

  const selectable = (i: number) => !!shown[i] && !shown[i].header
  useEffect(() => { if (query) setIdx(shown.findIndex(i => !i.header)) }, [query])
  useEffect(() => { listRef.current?.children[idx]?.scrollIntoView({ block: 'nearest' }) }, [idx, shown])
  useEffect(() => { inputRef.current?.focus() }, [])

  // keep anchored popups on screen
  useLayoutEffect(() => {
    if (!anchor || !cardRef.current) { setPos(null); return }
    const r = cardRef.current.getBoundingClientRect()
    const left = Math.max(8, Math.min(anchor.x, window.innerWidth - r.width - 8))
    let top = anchor.y
    if (top + r.height > window.innerHeight - 8) top = Math.max(8, anchor.y - r.height - 24)
    setPos({ left, top })
  }, [anchor?.x, anchor?.y, shown.length])

  const pick = (i: number) => {
    const it = shown[i]
    if (!it || it.header) return
    close()
    it.onPick?.()
  }
  const move = (d: number) => {
    if (!shown.length) return
    let i = idx
    for (let n = 0; n < shown.length; n++) {
      i = (i + d + shown.length) % shown.length
      if (selectable(i)) break
    }
    setIdx(i)
  }

  useEffect(() => {
    if (!releaseCtrlPicks) return
    const up = (e: KeyboardEvent) => { if (e.key === 'Control') pick(idx) }
    window.addEventListener('keyup', up)
    return () => window.removeEventListener('keyup', up)
  }, [releaseCtrlPicks, idx, shown])

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); close() }
    else if (e.key === 'ArrowDown' || (e.key === 'Tab' && e.ctrlKey && !e.shiftKey)) { e.preventDefault(); move(1) }
    else if (e.key === 'ArrowUp' || (e.key === 'Tab' && e.ctrlKey && e.shiftKey)) { e.preventDefault(); move(-1) }
    else if (e.key === 'PageDown') { e.preventDefault(); setIdx(i => Math.min(shown.length - 1, i + 10)) }
    else if (e.key === 'PageUp') { e.preventDefault(); setIdx(i => Math.max(0, i - 10)) }
    else if (e.key === 'Enter') { e.preventDefault(); pick(idx) }
  }

  const showInput = filter || items.length > 8
  return (
    <div className={`modal-overlay pl-overlay${anchor ? ' anchored' : ''}`} onMouseDown={close}>
      <div ref={cardRef} className={`pl-card${anchor ? ' anchored' : ''}`} onMouseDown={(e) => e.stopPropagation()}
        style={anchor ? { position: 'fixed', left: pos?.left ?? anchor.x, top: pos?.top ?? anchor.y, visibility: pos ? 'visible' : 'hidden' } : undefined}
        onKeyDown={onKey} tabIndex={-1}>
        <div className="pl-title">{title}</div>
        {showInput
          ? <input ref={inputRef} className="pl-input" value={query} placeholder="Type to filter" onChange={(e) => setQuery(e.target.value)} />
          : <input ref={inputRef} className="pl-input-hidden" value="" onChange={() => {}} aria-hidden />}
        <div className="pl-list scroll-slim" ref={listRef}>
          {shown.length === 0 && <div className="pl-empty">{empty ?? 'Nothing to show'}</div>}
          {shown.map((it, i) => it.header
            ? <div key={`h${i}`} className="pl-header">{it.label}</div>
            : (
              <div key={`${it.id}-${i}`} className={`pl-row${i === idx ? ' active' : ''}`} style={it.depth ? { paddingLeft: 12 + it.depth * 16 } : undefined}
                onMouseMove={() => setIdx(i)} onClick={() => pick(i)}>
                <SymbolIcon kind={it.icon} name={it.label} />
                <span className="pl-label"><Marked text={it.label} mark={it.mark} /></span>
                {it.detail && <span className="pl-detail">{it.detail}</span>}
                {it.hint && <span className="pl-hint">{it.hint}</span>}
              </div>
            ))}
        </div>
        {footer && <button className="pl-footer" onClick={() => { close(); footer.onClick() }}>{footer.label}</button>}
      </div>
    </div>
  )
}
