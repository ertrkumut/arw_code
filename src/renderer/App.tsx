import React, { useEffect } from 'react'
import { useApp } from './store/appStore'
import { TitleBar } from './components/TitleBar'
import { Sidebar } from './components/Sidebar'
import { TerminalGrid } from './components/TerminalGrid'
import { oceanic } from './theme'
import { DEFAULT_SIDEBAR_PCT } from '@shared/constants'
import type { TermState } from '@shared/types'

export default function App() {
  const { load, loaded, setStatus } = useApp()
  useEffect(() => {
    load()
    window.arw.onStatus(({ id, state }) => setStatus(id, state as TermState))
  }, [])
  if (!loaded) return <div style={{ background: oceanic.bgBase, height: '100vh' }} />
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: oceanic.bgBase }}>
      <TitleBar />
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        <div style={{ width: `${DEFAULT_SIDEBAR_PCT}%`, minWidth: 240, background: oceanic.bgSidebar, borderRight: `1px solid ${oceanic.border}` }}>
          <Sidebar />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}><TerminalGrid /></div>
      </div>
    </div>
  )
}
