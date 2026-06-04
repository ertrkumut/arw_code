import React, { useEffect } from 'react'
import { useApp } from './store/appStore'
import { TitleBar } from './components/TitleBar'
import { Sidebar } from './components/Sidebar'
import { SidebarRail } from './components/SidebarRail'
import { TerminalGrid } from './components/TerminalGrid'
import { oceanic } from './theme'
import { DEFAULT_SIDEBAR_PCT } from '@shared/constants'
import type { TermState } from '@shared/types'

const RAIL_WIDTH = 54

export default function App() {
  const { load, loaded, setStatus, sidebarCollapsed } = useApp()
  useEffect(() => {
    load()
    window.arw.onStatus(({ id, state }) => setStatus(id, state as TermState))
    // Torn-off windows talk back: returned to the grid, or closed (shell killed).
    window.arw.onReattached(({ id }) => useApp.getState().reattachTerminal(id))
    window.arw.onClosed(({ id }) => useApp.getState().dropTerminal(id))
  }, [])
  if (!loaded) return <div style={{ background: oceanic.bgBase, height: '100vh' }} />
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: oceanic.bgBase }}>
      <TitleBar />
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        <div style={{
          width: sidebarCollapsed ? RAIL_WIDTH : `${DEFAULT_SIDEBAR_PCT}%`,
          minWidth: sidebarCollapsed ? RAIL_WIDTH : 240,
          flexShrink: 0,
          background: oceanic.bgSidebar,
          borderRight: `1px solid ${oceanic.border}`,
          transition: 'width .18s ease, min-width .18s ease',
          overflow: 'hidden'
        }}>
          {sidebarCollapsed ? <SidebarRail /> : <Sidebar />}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}><TerminalGrid /></div>
      </div>
    </div>
  )
}
