import React, { useEffect, useRef, useState } from 'react'
import { useApp } from './store/appStore'
import { TitleBar } from './components/TitleBar'
import { Sidebar } from './components/Sidebar'
import { SidebarRail } from './components/SidebarRail'
import { TerminalGrid } from './components/TerminalGrid'
import { ConfirmDialog } from './components/ConfirmDialog'
import { HistoryDialog } from './components/HistoryDialog'
import { ImageLightbox } from './components/ImageLightbox'
import { oceanic } from './theme'
import { DEFAULT_SIDEBAR_PCT } from '@shared/constants'
import type { TermState } from '@shared/types'

const RAIL_WIDTH = 54

export default function App() {
  const { load, loaded, setStatus, sidebarCollapsed, sidebarWidthPct, setSidebarWidth,
    closeRequest, confirmClose, cancelClose } = useApp()
  const bodyRef = useRef<HTMLDivElement>(null)
  const [dragging, setDragging] = useState(false)

  useEffect(() => {
    load()
    window.arw.onStatus(({ id, state }) => setStatus(id, state as TermState))
    // Torn-off windows talk back: returned to the grid, or closed (shell killed).
    window.arw.onReattached(({ id }) => useApp.getState().reattachTerminal(id))
    window.arw.onClosed(({ id }) => useApp.getState().dropTerminal(id))
  }, [])

  // Global shortcuts (Ctrl/Cmd + …): N spawns a terminal in the selected project,
  // W closes the selected terminal, 1-9 selects the Nth terminal in the grid.
  // Capture phase + preventDefault so xterm doesn't forward them to the shell.
  // Skipped while renaming a terminal or while the confirm dialog owns the keyboard.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return
      const key = e.key.toLowerCase()
      const isDigit = key.length === 1 && key >= '1' && key <= '9'
      if (key !== 'n' && key !== 'w' && !isDigit) return

      const ae = document.activeElement
      if (ae instanceof HTMLInputElement && ae.classList.contains('tname-input')) return

      const st = useApp.getState()
      if (st.closeRequest || st.historyFor || st.lightbox) return   // a modal owns the keyboard while open

      // Visible terminals of the selected project, in grid order.
      const proj = st.projects.find(p => p.id === st.selectedProjectId)
      const visible = proj
        ? proj.terminals.filter(t => !t.detached).sort((a, b) => a.order - b.order)
        : []

      if (key === 'n') {
        if (!st.selectedProjectId) return
        e.preventDefault(); e.stopImmediatePropagation()
        st.addTerminal(st.selectedProjectId)
        return
      }
      if (isDigit) {
        const target = visible[Number(key) - 1]
        if (!target) return
        e.preventDefault(); e.stopImmediatePropagation()
        st.focusTerminal(target.id)
        return
      }
      // key === 'w' — resolve the focused terminal of the selected project,
      // mirroring ProjectGrid's effectiveFocus (fall back to first visible pane).
      if (!proj) return
      const target = visible.find(t => t.id === st.focusedTermId) ?? visible[0]
      if (!target) return
      e.preventDefault(); e.stopImmediatePropagation()
      st.requestRemoveTerminal(proj.id, target.id)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

  // Drag the divider: translate cursor X into a sidebar width % of the body row.
  const startResize = (e: React.PointerEvent) => {
    const body = bodyRef.current
    if (!body) return
    e.preventDefault()
    setDragging(true)
    const rect = body.getBoundingClientRect()
    const onMove = (ev: PointerEvent) => {
      const pct = ((ev.clientX - rect.left) / rect.width) * 100
      setSidebarWidth(pct, false) // live: update state without persisting
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      setDragging(false)
      useApp.getState().persist() // commit final width to disk
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }
  if (!loaded) return <div style={{ background: oceanic.bgBase, height: '100vh' }} />
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: oceanic.bgBase }}>
      <TitleBar />
      <div ref={bodyRef} style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        <div style={{
          width: sidebarCollapsed ? RAIL_WIDTH : `${sidebarWidthPct}%`,
          minWidth: sidebarCollapsed ? RAIL_WIDTH : 240,
          flexShrink: 0,
          background: oceanic.bgSidebar,
          borderRight: sidebarCollapsed ? `1px solid ${oceanic.border}` : 'none',
          // Only animate width while NOT dragging, so the divider tracks the cursor 1:1.
          transition: dragging ? 'none' : 'width .18s ease, min-width .18s ease',
          overflow: 'hidden'
        }}>
          {sidebarCollapsed ? <SidebarRail /> : <Sidebar />}
        </div>
        {!sidebarCollapsed && (
          <div
            className={`sidebar-resizer${dragging ? ' active' : ''}`}
            onPointerDown={startResize}
            onDoubleClick={() => setSidebarWidth(DEFAULT_SIDEBAR_PCT)}
            role="separator"
            aria-orientation="vertical"
            title="Drag to resize · double-click to reset"
          />
        )}
        <div style={{ flex: 1, minWidth: 0 }}><TerminalGrid /></div>
      </div>
      {closeRequest && (
        <ConfirmDialog
          title="Close terminal?"
          message={<>Claude is still working in <b>{closeRequest.name}</b>. Closing it now will stop the running task. Are you sure?</>}
          confirmLabel="Close terminal"
          cancelLabel="Keep running"
          danger
          onConfirm={confirmClose}
          onCancel={cancelClose}
        />
      )}
      <HistoryDialog />
      <ImageLightbox />
    </div>
  )
}
