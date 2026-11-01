import React from 'react'
import { oceanic } from '../theme'
import logo from '../assets/arw-logo.svg'
import { useApp } from '../store/appStore'
import { ThemePicker } from './ide/RunWidget'

/** Opens (or focuses) the selected project's IDE window. */
function OpenIdeButton() {
  const project = useApp(s => s.projects.find(p => p.id === s.selectedProjectId))
  return (
    <button className="tb-btn" disabled={!project} title="Open IDE for this project"
      onClick={() => project && window.arw.ide.open({ projectId: project.id, name: project.name, path: project.path })}>
      <svg width="16" height="16" viewBox="0 0 16 16"><rect x="1.5" y="2.5" width="13" height="11" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.2" /><path d="M5 6.5L3.5 8 5 9.5M11 6.5L12.5 8 11 9.5M9 5.5l-2 5" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
    </button>
  )
}

export function TitleBar() {
  const explorerOpen = useApp(s => s.explorerOpen)
  const toggleExplorer = useApp(s => s.toggleExplorer)
  return (
    <div className="titlebar" style={{
      height: 40, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 10,
      padding: '0 14px', background: oceanic.bgSidebar, borderBottom: `1px solid ${oceanic.border}`,
      userSelect: 'none'
    }}>
      <img src={logo} width={24} height={24} alt="" draggable={false} title="ARWCode — for Arwen" style={{ display: 'block' }} />
      <span style={{ fontSize: 13, fontWeight: 600, letterSpacing: '.02em', color: oceanic.textPrimary }}>ARWCode</span>
      <span title="App version" style={{
        fontFamily: "'JetBrains Mono', monospace", fontSize: 10.5, color: oceanic.textSecondary,
        padding: '1px 6px', border: `1px solid ${oceanic.border}`, borderRadius: 4
      }}>v{__APP_VERSION__}</span>
      {/* Right of this sits the native window-controls overlay (~140px). */}
      <div style={{ flex: 1 }} />
      <OpenIdeButton />
      <ThemePicker />
      <button className={`tb-btn${explorerOpen ? ' active' : ''}`} style={{ marginRight: 140 }}
        title={`${explorerOpen ? 'Hide' : 'Show'} File Explorer (Ctrl+Shift+E)`} onClick={toggleExplorer}>
        <svg width="16" height="16" viewBox="0 0 16 16">
          <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.2" />
          <path d="M10 2.5v11" stroke="currentColor" strokeWidth="1.2" />
          {explorerOpen && <rect x="10" y="2.5" width="4.5" height="11" rx="1" fill="currentColor" opacity=".35" />}
        </svg>
      </button>
    </div>
  )
}
