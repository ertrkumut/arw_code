import React, { useEffect, useState } from 'react'
import { useDebug } from '../../store/debugStore'
import { useIde } from '../../store/ideStore'
import { DebugControls } from './DebugPanel'
import { THEMES } from '../../themes'
import { ContextMenu } from '../ContextMenu'

/** True when the folder is a Unity project (has ProjectSettings/ProjectVersion.txt). */
export function useIsUnityProject(path: string | undefined) {
  const [isUnity, setIsUnity] = useState(false)
  useEffect(() => {
    let alive = true
    setIsUnity(false)
    if (path) window.arw.pathExists(`${path}/ProjectSettings/ProjectVersion.txt`).then(v => { if (alive) setIsUnity(v) })
    return () => { alive = false }
  }, [path])
  return isUnity
}

const Bug = () => (
  <svg width="16" height="16" viewBox="0 0 16 16">
    <path d="M5.5 4.5a2.5 2.5 0 0 1 5 0" fill="none" stroke="currentColor" strokeWidth="1.3" />
    <rect x="4.5" y="5" width="7" height="8.5" rx="3.5" fill="currentColor" />
    <path d="M2 8h2.5M11.5 8H14M2.5 4.5l2 1.5M13.5 4.5l-2 1.5M2.5 12.5l2-1.5M13.5 12.5l-2-1.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
  </svg>
)

/** Title-bar widget, Rider-style: run configuration + debug button (or live controls while attached). */
export function RunWidget({ project }: { project: { id: string; name: string; path: string } }) {
  const isUnity = useIsUnityProject(project.path)
  const phase = useDebug(s => s.phase)
  const attached = phase !== 'idle'
  const debuggingName = project.name

  const attach = () => {
    if (!isUnity) return
    useIde.getState().setDebugOpen(true)
    void useDebug.getState().attach(project.id, project.path)
  }

  return (
    <div className="run-widget nodrag">
      <div className={`run-config${attached ? ' live' : ''}`}
        title={attached ? `Debugging ${debuggingName ?? ''}` : isUnity ? 'Attach the debugger to the Unity Editor that has this project open' : 'Select a Unity project to debug'}>
        <span className="run-config-ico">◆</span>
        {attached ? `Unity · ${debuggingName ?? ''}` : 'Attach to Unity Editor'}
      </div>
      {attached ? (
        <DebugControls compact />
      ) : (
        <button className="tb-btn debug" disabled={!isUnity} onClick={attach}
          title={isUnity ? 'Debug: Attach to Unity Editor (Shift+F9)' : 'Not a Unity project'}>
          <Bug />
        </button>
      )}
    </div>
  )
}

/** Theme switcher in the title bar. */
export function ThemePicker() {
  const themeId = useIde(s => s.themeId)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  return (
    <>
      <button className="tb-btn nodrag" title="Theme"
        onClick={(e) => { const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); setMenu({ x: r.left - 120, y: r.bottom + 4 }) }}>
        <svg width="16" height="16" viewBox="0 0 16 16"><circle cx="8" cy="8" r="5.8" fill="none" stroke="currentColor" strokeWidth="1.2" /><path d="M8 2.2a5.8 5.8 0 0 1 0 11.6z" fill="currentColor" /></svg>
      </button>
      {menu && (
        <ContextMenu x={menu.x} y={menu.y} onClose={() => setMenu(null)}
          items={THEMES.map(t => ({ label: `${t.id === themeId ? '✓  ' : '    '}${t.name}`, onClick: () => useIde.getState().setTheme(t.id) }))} />
      )}
    </>
  )
}
