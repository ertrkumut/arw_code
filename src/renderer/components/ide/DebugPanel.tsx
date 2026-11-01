import React, { useEffect, useRef, useState } from 'react'
import { useDebug, type DapVariable } from '../../store/debugStore'
import { baseName } from '../../ide/paths'

// ---- toolbar icons (16px, currentColor) ----
const I = {
  resume: <svg width="16" height="16" viewBox="0 0 16 16"><path d="M3 3v10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /><path d="M6 3.2v9.6L13.5 8z" fill="currentColor" /></svg>,
  pause: <svg width="16" height="16" viewBox="0 0 16 16"><rect x="4" y="3" width="2.6" height="10" rx=".6" fill="currentColor" /><rect x="9.4" y="3" width="2.6" height="10" rx=".6" fill="currentColor" /></svg>,
  stop: <svg width="16" height="16" viewBox="0 0 16 16"><rect x="3.5" y="3.5" width="9" height="9" rx="1.2" fill="currentColor" /></svg>,
  over: <svg width="16" height="16" viewBox="0 0 16 16"><path d="M2.5 9.5a5.5 5.5 0 0 1 10.4-2.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /><path d="M13.5 3.5v3.8H9.7" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /><circle cx="8" cy="13" r="1.5" fill="currentColor" /></svg>,
  into: <svg width="16" height="16" viewBox="0 0 16 16"><path d="M8 2v7.5M4.8 6.5L8 9.7l3.2-3.2" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /><circle cx="8" cy="13" r="1.5" fill="currentColor" /></svg>,
  out: <svg width="16" height="16" viewBox="0 0 16 16"><path d="M8 10V2.5M4.8 5.7L8 2.5l3.2 3.2" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /><circle cx="8" cy="13" r="1.5" fill="currentColor" /></svg>
}

export const DebugIcons = I

function ToolBtn({ title, onClick, disabled, children, tone }: { title: string; onClick: () => void; disabled?: boolean; children: React.ReactNode; tone?: 'green' | 'red' }) {
  return (
    <button className={`dbg-btn${tone ? ' ' + tone : ''}`} title={title} disabled={disabled} onClick={onClick}>{children}</button>
  )
}

/** Resume / pause / stop / step buttons, shared by the Debug window and the title bar. */
export function DebugControls({ compact = false }: { compact?: boolean }) {
  const phase = useDebug(s => s.phase)
  const d = useDebug.getState()
  const paused = phase === 'paused'
  return (
    <div className={`dbg-controls${compact ? ' compact' : ''}`}>
      <ToolBtn title="Resume Program (F9)" tone="green" disabled={!paused} onClick={d.resume}>{I.resume}</ToolBtn>
      <ToolBtn title="Pause Program" disabled={phase !== 'running'} onClick={d.pause}>{I.pause}</ToolBtn>
      <ToolBtn title="Stop / Detach (Ctrl+F2)" tone="red" disabled={phase === 'idle'} onClick={d.stop}>{I.stop}</ToolBtn>
      <span className="dbg-sep" />
      <ToolBtn title="Step Over (F8)" disabled={!paused} onClick={d.stepOver}>{I.over}</ToolBtn>
      <ToolBtn title="Step Into (F7)" disabled={!paused} onClick={d.stepInto}>{I.into}</ToolBtn>
      <ToolBtn title="Step Out (Shift+F8)" disabled={!paused} onClick={d.stepOut}>{I.out}</ToolBtn>
    </div>
  )
}

function VarRow({ v, depth }: { v: DapVariable; depth: number }) {
  const [open, setOpen] = useState(false)
  const children = useDebug(s => (v.variablesReference ? s.vars[v.variablesReference] : undefined))
  const expandable = v.variablesReference > 0
  const toggle = () => {
    if (!expandable) return
    if (!open) void useDebug.getState().loadVars(v.variablesReference)
    setOpen(!open)
  }
  const kind = v.presentationHint?.kind
  return (
    <>
      <div className="dbg-var" style={{ paddingLeft: 8 + depth * 16 }} onClick={toggle}
        title={`${v.name}${v.type ? ` {${v.type}}` : ''} = ${v.value}`}>
        <span className="dbg-chev">{expandable ? (open ? '▾' : '▸') : ''}</span>
        <span className={`dbg-var-ico${kind === 'property' ? ' prop' : kind === 'method' ? ' meth' : ''}`}>{kind === 'property' ? 'p' : 'f'}</span>
        <span className="dbg-var-name">{v.name}</span>
        <span className="dbg-var-eq"> = </span>
        {v.type && <span className="dbg-var-type">{'{'}{v.type}{'} '}</span>}
        <span className={`dbg-var-val${/^".*"$/.test(v.value) ? ' str' : /^-?\d/.test(v.value) ? ' num' : ''}`}>{v.value}</span>
      </div>
      {open && children === 'loading' && <div className="dbg-var muted" style={{ paddingLeft: 24 + (depth + 1) * 16 }}>Collecting data…</div>}
      {open && Array.isArray(children) && children.map((c, i) => <VarRow key={c.name + i} v={c} depth={depth + 1} />)}
    </>
  )
}

function ScopeBlock({ name, refId, defaultOpen }: { name: string; refId: number; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen)
  const vars = useDebug(s => s.vars[refId])
  useEffect(() => { if (open) void useDebug.getState().loadVars(refId) }, [open, refId])
  return (
    <>
      <div className="dbg-scope" onClick={() => setOpen(!open)}>
        <span className="dbg-chev">{open ? '▾' : '▸'}</span>{name}
      </div>
      {open && vars === 'loading' && <div className="dbg-var muted" style={{ paddingLeft: 24 }}>Collecting data…</div>}
      {open && Array.isArray(vars) && vars.map((v, i) => <VarRow key={v.name + i} v={v} depth={1} />)}
      {open && Array.isArray(vars) && vars.length === 0 && <div className="dbg-var muted" style={{ paddingLeft: 24 }}>No variables</div>}
    </>
  )
}

function Console() {
  const output = useDebug(s => s.output)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => { const el = ref.current; if (el) el.scrollTop = el.scrollHeight }, [output])
  return (
    <div ref={ref} className="dbg-console scroll-slim">
      {output.length === 0 ? <span className="muted">No output yet.</span> : output.map((l, i) => <div key={i}>{l}</div>)}
    </div>
  )
}

/** Rider-style Debug tool window: Frames | Variables, plus a Console tab. */
export function DebugPanel({ onHide }: { onHide?: () => void }) {
  const phase = useDebug(s => s.phase)
  const frames = useDebug(s => s.frames)
  const frameId = useDebug(s => s.frameId)
  const scopes = useDebug(s => s.scopes)
  const threads = useDebug(s => s.threads)
  const threadId = useDebug(s => s.threadId)
  const stopReason = useDebug(s => s.stopReason)
  const error = useDebug(s => s.error)
  const [tab, setTab] = useState<'vars' | 'console'>('vars')

  const top = frames.find(f => f.id === frameId)
  const status =
    phase === 'connecting' ? 'Connecting to Unity Editor…'
    : phase === 'running' ? 'Running — hit a breakpoint in Play mode to pause'
    : phase === 'paused' ? `Paused${stopReason ? ` (${stopReason})` : ''}${top?.source?.path ? ` at ${baseName(top.source.path)}:${top.line}` : ''}`
    : 'Not attached'

  return (
    <div className="dbg-root">
      <div className="dbg-head">
        <DebugControls />
        <span className="dbg-sep" />
        <div className="dbg-tabs">
          <button className={tab === 'vars' ? 'active' : ''} onClick={() => setTab('vars')}>Threads &amp; Variables</button>
          <button className={tab === 'console' ? 'active' : ''} onClick={() => setTab('console')}>Console</button>
        </div>
        <span className={`dbg-status ${phase}`}>{status}</span>
        {onHide && <button className="dbg-btn" title="Hide (Alt+5)" onClick={onHide}><svg width="16" height="16" viewBox="0 0 16 16"><path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg></button>}
      </div>
      {error && <div className="dbg-error" onClick={() => useDebug.getState().clearError()}>{error}</div>}
      {tab === 'console' ? <Console /> : (
        <div className="dbg-body">
          <div className="dbg-frames scroll-slim">
            {threads.length > 0 && (
              <div className="dbg-thread">
                <select value={threadId ?? ''} disabled={phase !== 'paused'}
                  onChange={(e) => void useDebug.getState().selectThread(Number(e.target.value))}>
                  {threads.map(t => <option key={t.id} value={t.id}>{t.name || `Thread ${t.id}`}</option>)}
                </select>
              </div>
            )}
            {phase !== 'paused' && <div className="dbg-empty">{phase === 'idle' ? 'Attach to Unity to start debugging.' : 'Frames are available when the program is paused.'}</div>}
            {frames.map(f => (
              <div key={f.id} className={`dbg-frame${f.id === frameId ? ' active' : ''}${f.source?.path ? '' : ' external'}`}
                onClick={() => void useDebug.getState().selectFrame(f)} title={f.source?.path ?? 'No source'}>
                <span className="dbg-frame-name">{f.name}</span>
                {f.source?.path && <span className="dbg-frame-loc">{baseName(f.source.path)}:{f.line}</span>}
              </div>
            ))}
          </div>
          <div className="dbg-vars scroll-slim">
            {phase !== 'paused' && <div className="dbg-empty">Variables are available when the program is paused.</div>}
            {phase === 'paused' && scopes.map((s, i) => (
              <ScopeBlock key={`${frameId}-${s.variablesReference}`} name={s.name} refId={s.variablesReference} defaultOpen={i === 0} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
