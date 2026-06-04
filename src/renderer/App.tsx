import React from 'react'
import { useTerminalIO } from './hooks/useTerminalIO'
import { oceanic } from './theme'

export default function App() {
  const ref = useTerminalIO('demo-1', process.env.HOME || 'C:\\')
  return (
    <div style={{ height: '100vh', background: oceanic.bgDeep }}>
      <div ref={ref} style={{ height: '100%' }} />
    </div>
  )
}
