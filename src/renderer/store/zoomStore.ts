import { create } from 'zustand'

/**
 * Ctrl+wheel font zoom for the chat pane and the terminals. Each has its own
 * size so a big chat font doesn't force a big shell. Persisted in localStorage
 * and mirrored across windows through the `storage` event, so a torn-off
 * terminal window follows the main window's zoom (and vice versa).
 */
export type ZoomTarget = 'chat' | 'term'

const KEY = 'arw.zoom'
export const ZOOM_MIN = 9
export const ZOOM_MAX = 28
export const ZOOM_DEFAULT: Record<ZoomTarget, number> = { chat: 13, term: 13 }

const clamp = (n: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(n)))

function load(): Record<ZoomTarget, number> {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? '')
    return {
      chat: clamp(Number(s.chat) || ZOOM_DEFAULT.chat),
      term: clamp(Number(s.term) || ZOOM_DEFAULT.term)
    }
  } catch { return { ...ZOOM_DEFAULT } }
}

interface ZoomState {
  chat: number
  term: number
  /** Step the size by `delta` px (wheel ticks map to ±1). */
  bump: (which: ZoomTarget, delta: number) => void
  reset: (which: ZoomTarget) => void
}

export const useZoom = create<ZoomState>((set, get) => ({
  ...load(),
  bump: (which, delta) => {
    const next = clamp(get()[which] + delta)
    if (next === get()[which]) return
    set({ [which]: next })
    save(get())
  },
  reset: (which) => { set({ [which]: ZOOM_DEFAULT[which] }); save(get()) }
}))

function save(s: ZoomState) {
  try { localStorage.setItem(KEY, JSON.stringify({ chat: s.chat, term: s.term })) } catch { /* storage off */ }
}

// Another window changed the zoom — adopt it.
window.addEventListener('storage', (e) => { if (e.key === KEY) useZoom.setState(load()) })

/**
 * Turn Ctrl/Cmd+wheel over `el` into zoom steps. Attached natively with
 * `passive: false` because React registers `wheel` as passive, which makes
 * preventDefault a no-op — and without it the page would also scroll.
 */
export function attachWheelZoom(el: HTMLElement, which: ZoomTarget): () => void {
  const onWheel = (e: WheelEvent) => {
    if (!(e.ctrlKey || e.metaKey) || e.deltaY === 0) return
    e.preventDefault()
    e.stopPropagation()
    useZoom.getState().bump(which, e.deltaY < 0 ? 1 : -1)
  }
  el.addEventListener('wheel', onWheel, { passive: false })
  return () => el.removeEventListener('wheel', onWheel)
}
