import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useIde } from '../../store/ideStore'
import { useNav } from '../../store/navStore'
import { getEditor } from '../../ide/context'
import {
  ACTIONS, keysFor, isOverridden, formatKeys, normalizeKeys, eventToStroke, conflictsFor, onKeymapChanged,
  type ActionDef, type Category
} from '../../ide/keymap'
import type { EditorPrefs } from '@shared/editorPrefs'

const CATEGORIES: Category[] = ['Navigation', 'Search', 'Code', 'Refactoring', 'Editing', 'Caret', 'Folding', 'Files', 'Debug', 'Tool Windows']

/** Settings (Ctrl+Alt+S): Editor options and the Keymap editor. */
export function SettingsDialog({ tab: initial }: { tab: 'keymap' | 'editor' }) {
  const [tab, setTab] = useState(initial)
  const close = () => { useNav.getState().close(); getEditor()?.focus() }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !(e.target as HTMLElement)?.closest?.('.km-recorder')) { e.preventDefault(); close() } }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  return (
    <div className="modal-overlay" onMouseDown={close}>
      <div className="st-card" onMouseDown={(e) => e.stopPropagation()}>
        <div className="st-nav">
          <div className="st-nav-title">Settings</div>
          <button className={tab === 'editor' ? 'active' : ''} onClick={() => setTab('editor')}>Editor</button>
          <button className={tab === 'keymap' ? 'active' : ''} onClick={() => setTab('keymap')}>Keymap</button>
        </div>
        <div className="st-body">
          {tab === 'editor' ? <EditorSettings /> : <KeymapSettings />}
        </div>
        <button className="st-close" title="Close (Esc)" onClick={close}>✕</button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------------------
// Editor
// ---------------------------------------------------------------------------------------

function Toggle({ k, label, hint }: { k: keyof EditorPrefs; label: string; hint?: string }) {
  const v = useIde(s => s.editorPrefs[k]) as boolean
  return (
    <label className="st-row">
      <input type="checkbox" checked={v} onChange={(e) => useIde.getState().setEditorPref(k, e.target.checked as never)} />
      <span className="st-label">{label}{hint && <span className="st-hint">{hint}</span>}</span>
    </label>
  )
}

function EditorSettings() {
  const fontSize = useIde(s => s.editorPrefs.fontSize)
  return (
    <div className="st-section">
      <div className="st-h">Code insight</div>
      <Toggle k="codeVision" label="Code Vision" hint="Usages, inheritors and Unity markers above declarations" />
      <Toggle k="inlayHints" label="Parameter name hints" hint="Shows parameter names before literal arguments: Move(speed: 5)" />
      <Toggle k="unityGutter" label="Gutter icons" hint="Unity event functions, overrides (↑) and implementations (↓)" />
      <div className="st-h">Appearance</div>
      <Toggle k="stickyScroll" label="Sticky lines" hint="Keep the current class / method header visible while scrolling" />
      <Toggle k="minimap" label="Minimap" />
      <Toggle k="wordWrap" label="Soft-wrap long lines" />
      <Toggle k="renderWhitespace" label="Show whitespace" />
      <label className="st-row">
        <span className="st-label">Font size</span>
        <input className="st-num" type="number" min={9} max={28} step={0.5} value={fontSize}
          onChange={(e) => { const v = parseFloat(e.target.value); if (v >= 9 && v <= 28) useIde.getState().setEditorPref('fontSize', v) }} />
      </label>
    </div>
  )
}

// ---------------------------------------------------------------------------------------
// Keymap
// ---------------------------------------------------------------------------------------

function useKeymapVersion() {
  const [, setN] = useState(0)
  const km = useIde(s => s.keymap)
  useEffect(() => onKeymapChanged(() => setN(n => n + 1)), [])
  return km
}

function KeymapSettings() {
  useKeymapVersion()
  const [query, setQuery] = useState('')
  const [byKey, setByKey] = useState<string | null>(null)
  const [recordingKey, setRecordingKey] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  const overriddenCount = Object.keys(useIde.getState().keymap).length

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return ACTIONS.filter(a => {
      if (byKey) return keysFor(a.id).some(k => normalizeKeys(k) === byKey || normalizeKeys(k).startsWith(byKey + ','))
      if (!q) return true
      return a.name.toLowerCase().includes(q) || a.id.toLowerCase().includes(q) || keysFor(a.id).some(k => formatKeys(k).toLowerCase().includes(q))
    })
  }, [query, byKey, useIde.getState().keymap])

  return (
    <div className="st-section km">
      <div className="km-top">
        {recordingKey
          ? <input autoFocus className="goto-input km-search km-recorder" readOnly value={byKey ? formatKeys(byKey) : 'Press a shortcut…'}
              onKeyDown={(e) => { e.preventDefault(); e.stopPropagation(); if (e.key === 'Escape') { setRecordingKey(false); setByKey(null); return } const s = eventToStroke(e.nativeEvent); if (s) setByKey(s) }} />
          : <input autoFocus className="goto-input km-search" placeholder="Search actions or shortcuts" value={query} onChange={(e) => setQuery(e.target.value)} />}
        <button className={`fp-opt${recordingKey ? ' on' : ''}`} title="Find actions by shortcut" onClick={() => { setRecordingKey(!recordingKey); setByKey(null) }}>⌨</button>
        <button className="btn-soft" disabled={!overriddenCount} title="Restore every shortcut to the Rider defaults"
          onClick={() => useIde.getState().resetKeymap()}>Reset all{overriddenCount ? ` (${overriddenCount})` : ''}</button>
      </div>
      <div className="km-note">Defaults follow your Rider keymap ("IntelliJ copy"). Changed shortcuts are marked and saved for every IDE window.</div>
      <div className="km-list scroll-slim">
        {CATEGORIES.map(cat => {
          const list = filtered.filter(a => a.category === cat)
          if (!list.length) return null
          return (
            <div key={cat}>
              <div className="km-cat">{cat}</div>
              {list.map(a => <KeymapRow key={a.id} a={a} editing={editing === a.id} onEdit={(on) => setEditing(on ? a.id : null)} />)}
            </div>
          )
        })}
        {!filtered.length && <div className="pl-empty">No actions match.</div>}
      </div>
    </div>
  )
}

function KeymapRow({ a, editing, onEdit }: { a: ActionDef; editing: boolean; onEdit: (on: boolean) => void }) {
  const keys = keysFor(a.id)
  const changed = isOverridden(a.id)
  const set = (next: string[]) => useIde.getState().setKeys(a.id, next)
  return (
    <div className={`km-row${changed ? ' changed' : ''}`}>
      <span className="km-name" title={a.id}>{a.name}{changed && <span className="km-dot" title="Changed from default" />}</span>
      <span className="km-keys">
        {keys.map(k => (
          <span key={k} className="km-chip">{formatKeys(k)}<button title="Remove shortcut" onClick={() => set(keys.filter(x => x !== k))}>×</button></span>
        ))}
        {!keys.length && <span className="km-none">—</span>}
      </span>
      <span className="km-actions">
        <button className="km-btn" title="Add keyboard shortcut" onClick={() => onEdit(!editing)}>+</button>
        {changed && <button className="km-btn" title={`Reset to default (${a.keys.map(formatKeys).join(', ') || 'none'})`} onClick={() => useIde.getState().setKeys(a.id, null)}>↺</button>}
      </span>
      {editing && <Recorder a={a} onDone={() => onEdit(false)} />}
    </div>
  )
}

/** Captures one keystroke, optionally a second (chord), shows conflicts, then saves. */
function Recorder({ a, onDone }: { a: ActionDef; onDone: () => void }) {
  const [first, setFirst] = useState<string | null>(null)
  const [second, setSecond] = useState<string | null>(null)
  const [chord, setChord] = useState(false)
  const [removeOthers, setRemoveOthers] = useState(true)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => { ref.current?.focus() }, [chord])
  const spec = first ? (chord && second ? `${first}, ${second}` : first) : null
  const conflicts = spec ? conflictsFor(spec, a.id) : []

  const save = () => {
    if (!spec) return
    const st = useIde.getState()
    if (removeOthers) for (const c of conflicts) st.setKeys(c.id, keysFor(c.id).filter(k => normalizeKeys(k) !== normalizeKeys(spec)))
    const cur = keysFor(a.id)
    if (!cur.some(k => normalizeKeys(k) === normalizeKeys(spec))) st.setKeys(a.id, [...cur, spec])
    onDone()
  }

  return (
    <div className="km-rec">
      <div ref={ref} tabIndex={0} className="km-recorder"
        onKeyDown={(e) => {
          e.preventDefault(); e.stopPropagation()
          if (e.key === 'Escape' && !first) { onDone(); return }
          const s = eventToStroke(e.nativeEvent)
          if (!s) return
          if (chord && first) setSecond(s); else setFirst(s)
        }}>
        {spec ? formatKeys(spec) : 'Press keys…'}
        {chord && first && !second && <span className="km-wait"> then second stroke…</span>}
      </div>
      <label className="km-check"><input type="checkbox" checked={chord} onChange={(e) => { setChord(e.target.checked); setSecond(null) }} /> Second stroke</label>
      {conflicts.length > 0 && (
        <div className="km-conflict">
          Already used by {conflicts.map(c => <b key={c.id}>{c.name}</b>).reduce<React.ReactNode[]>((acc, el, i) => (i ? [...acc, ', ', el] : [el]), [])}.
          <label className="km-check"><input type="checkbox" checked={removeOthers} onChange={(e) => setRemoveOthers(e.target.checked)} /> Remove it there</label>
        </div>
      )}
      <div className="km-rec-actions">
        <button className="btn-soft" onClick={() => { setFirst(null); setSecond(null); ref.current?.focus() }}>Clear</button>
        <button className="btn-soft" onClick={onDone}>Cancel</button>
        <button className="btn-modal" disabled={!spec || (chord && !second)} onClick={save}>OK</button>
      </div>
    </div>
  )
}
