import React, { useEffect } from 'react'
import { useApp } from './store/appStore'
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

  if (!loaded) return <div style={{ background: oceanic.bgDeep, height: '100vh' }} />

  return (
    <div style={{ display: 'flex', height: '100vh', background: oceanic.bgDeep }}>
      <div style={{ width: `${DEFAULT_SIDEBAR_PCT}%`, minWidth: 220, background: oceanic.bgPanel }}>
        <Sidebar />
      </div>
      <div style={{ flex: 1 }}><TerminalGrid /></div>
    </div>
  )
}
