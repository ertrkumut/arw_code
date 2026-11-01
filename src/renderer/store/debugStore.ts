import { create } from 'zustand'
import { useIde } from './ideStore'
import { fileKey } from '../ide/paths'

/** Debug Adapter Protocol shapes we use (subset). */
export interface DapStackFrame { id: number; name: string; line: number; column: number; source?: { path?: string; name?: string }; presentationHint?: string }
export interface DapScope { name: string; variablesReference: number; expensive?: boolean }
export interface DapVariable { name: string; value: string; type?: string; variablesReference: number; presentationHint?: { kind?: string } }
export interface DapThread { id: number; name: string }

export type DebugPhase = 'idle' | 'connecting' | 'running' | 'paused'

interface DebugState {
  phase: DebugPhase
  projectId: string | null
  projectPath: string | null
  threads: DapThread[]
  threadId: number | null            // thread we're stopped on / stepping
  stopReason: string | null
  frames: DapStackFrame[]
  frameId: number | null             // selected frame
  scopes: DapScope[]
  vars: Record<number, DapVariable[] | 'loading'>   // variablesReference -> children
  /** fileKey -> line -> verified (false = set but not bound yet / no code there) */
  verified: Record<string, Record<number, boolean>>
  output: string[]
  error: string | null
  canBreakNow: boolean               // 'initialized' arrived → setBreakpoints accepted

  attach: (projectId: string, projectPath: string) => Promise<void>
  stop: () => void
  resume: () => void
  pause: () => void
  stepOver: () => void
  stepInto: () => void
  stepOut: () => void
  selectFrame: (frame: DapStackFrame) => Promise<void>
  selectThread: (threadId: number) => Promise<void>
  loadVars: (ref: number) => Promise<void>
  evaluate: (expression: string, context: 'hover' | 'watch' | 'repl') => Promise<{ result: string; type?: string; variablesReference: number } | null>
  syncBreakpoints: (path: string) => void
  clearError: () => void
}

const MAX_OUTPUT = 2000
const req = (command: string, args?: unknown) => window.arw.debug.request(command, args)

// Noise the adapter prints for every loaded assembly.
const isNoise = (s: string) => /^\[Mono\] Loaded assembly:/.test(s)

/** Default evaluation options, matching what DotRush sends to monodbg for Unity. */
const debuggerOptions = {
  evaluationOptions: {
    evaluationTimeout: 1000, memberEvaluationTimeout: 5000, allowTargetInvoke: true, allowMethodEvaluation: true,
    allowToStringCalls: true, flattenHierarchy: false, groupPrivateMembers: true, groupStaticMembers: true,
    useExternalTypeResolver: false, integerDisplayFormat: 'Decimal', currentExceptionTag: '$exception',
    ellipsizeStrings: true, ellipsizedLength: 260,
    stackFrameFormat: { module: false, parameterTypes: false, parameterValues: false, parameterNames: false, language: false, line: false }
  },
  stepOverPropertiesAndOperators: true,
  projectAssembliesOnly: true,
  automaticSourceLinkDownload: false,
  symbolSearchPaths: [],
  searchMicrosoftSymbolServer: false,
  skipNativeTransitions: true
}

let wired = false
// Capabilities from the adapter's `initialize` response. Only send optional requests it
// advertises — monodbg crashes on an unsupported `configurationDone`.
let caps: Record<string, any> = {}
// Adapter breakpoint id -> where it lives; later `breakpoint` events only carry the id.
const bpIds = new Map<number, { key: string; line: number }>()

export const useDebug = create<DebugState>((set, get) => {
  const log = (line: string) => set((st) => ({ output: [...st.output, line].slice(-MAX_OUTPUT) }))
  const reset = (error: string | null = null) => set({
    phase: 'idle', projectId: null, projectPath: null, threads: [], threadId: null, stopReason: null,
    frames: [], frameId: null, scopes: [], vars: {}, verified: {}, canBreakNow: false, error
  })
  const clearPause = () => set({ frames: [], frameId: null, scopes: [], vars: {}, stopReason: null })

  const sendAllBreakpoints = async () => {
    const bps = Object.values(useIde.getState().breakpoints)
    await Promise.all(bps.map(b => sendBreakpoints(b.path, b.lines)))
  }
  const sendBreakpoints = async (path: string, lines: number[]) => {
    try {
      const r = await req('setBreakpoints', {
        source: { path, name: path.replace(/\\/g, '/').split('/').pop() },
        breakpoints: lines.map(line => ({ line })), lines, sourceModified: false
      })
      const v: Record<number, boolean> = {}
      const k = fileKey(path)
      for (const [id, at] of bpIds) if (at.key === k) bpIds.delete(id)
      ;(r.breakpoints ?? []).forEach((b: any, i: number) => {
        v[lines[i]] = !!b.verified
        if (typeof b.id === 'number') bpIds.set(b.id, { key: k, line: lines[i] })
      })
      set((st) => ({ verified: { ...st.verified, [fileKey(path)]: v } }))
    } catch (e: any) { log(`setBreakpoints failed for ${path}: ${e.message}`) }
  }

  const onStopped = async (body: any) => {
    set({ phase: 'paused', stopReason: body.reason ?? 'pause' })
    useIde.getState().setDebugOpen(true)
    try {
      const t = await req('threads')
      set({ threads: t.threads ?? [] })
    } catch { /* keep the old list */ }
    // A breakpoint names its thread. A manual pause stops every thread — show Unity's
    // main thread then, not whichever Burst/worker thread happens to be first.
    const threads = get().threads
    const main = threads.find(t => /^main thread$/i.test(t.name)) ?? threads.find(t => /main/i.test(t.name))
    const threadId: number = (body.reason === 'pause' || body.allThreadsStopped) && main && body.reason !== 'breakpoint'
      ? main.id
      : body.threadId ?? main?.id ?? threads[0]?.id ?? 0
    set({ threadId })
    if (await loadFrames(threadId) || body.reason === 'breakpoint') return
    // That thread is in native code (an idle Editor's main loop has no managed frames):
    // show the first thread that does have C# frames.
    for (const t of threads) {
      if (t.id === threadId || get().phase !== 'paused') continue
      set({ threadId: t.id })
      if (await loadFrames(t.id)) return
    }
    set({ threadId })
  }

  /** Fetch a thread's stack and select its first frame with source. Returns frame count. */
  const loadFrames = async (threadId: number): Promise<number> => {
    try {
      const st = await req('stackTrace', { threadId, startFrame: 0, levels: 64 })
      const frames: DapStackFrame[] = st.stackFrames ?? []
      set({ frames })
      // First frame with source (user code) — external frames have no file.
      const top = frames.find(f => f.source?.path) ?? frames[0]
      if (top) await get().selectFrame(top)
      else set({ frameId: null, scopes: [], vars: {} })
      return frames.length
    } catch (e: any) { set({ frames: [] }); log(`stackTrace failed: ${e.message}`); return 0 }
  }

  const wire = () => {
    if (wired) return
    wired = true
    window.arw.debug.onEvent(({ event, body }) => {
      switch (event) {
        case 'initialized':
          set({ canBreakNow: true })
          void (async () => {
            await sendAllBreakpoints()
            if (caps.exceptionBreakpointFilters) {
              try { await req('setExceptionBreakpoints', { filters: [] }) } catch { /* optional */ }
            }
            if (caps.supportsConfigurationDoneRequest) {
              try { await req('configurationDone') } catch (e: any) { log(`configurationDone: ${e.message}`) }
            }
          })()
          break
        case 'stopped': void onStopped(body); break
        case 'continued': if (get().phase === 'paused') { clearPause(); set({ phase: 'running' }) } break
        case 'thread':
          if (body.reason === 'exited') set((st) => ({ threads: st.threads.filter(t => t.id !== body.threadId) }))
          break
        case 'breakpoint': {
          // Bound later, once Unity loads the type. Matched by id (the event has no source).
          const b = body.breakpoint
          const at = typeof b?.id === 'number' ? bpIds.get(b.id) : undefined
          if (at) set((st) => ({ verified: { ...st.verified, [at.key]: { ...st.verified[at.key], [at.line]: !!b.verified } } }))
          break
        }
        case 'output': {
          const text = String(body.output ?? '').replace(/\r?\n$/, '')
          if (text && !isNoise(text)) log(text)
          break
        }
        case 'terminated': case 'exited':
          if (get().phase !== 'idle') { log('Debugger detached.'); window.arw.debug.stop(); reset() }
          break
      }
    })
    // Breakpoints added/removed/moved while attached go to the adapter right away.
    useIde.subscribe((st, prev) => {
      if (st.breakpoints === prev.breakpoints) return
      const keys = new Set([...Object.keys(st.breakpoints), ...Object.keys(prev.breakpoints)])
      for (const k of keys) {
        if (st.breakpoints[k] === prev.breakpoints[k]) continue
        get().syncBreakpoints((st.breakpoints[k] ?? prev.breakpoints[k]).path)
      }
    })
    window.arw.debug.onExit(({ code, stderr }) => {
      if (get().phase === 'idle') return
      reset(code || stderr.trim() ? `Debugger exited${code ? ` (code ${code})` : ''}. ${stderr.trim().slice(-400)}` : 'Debugger exited unexpectedly.')
    })
  }

  const step = (command: string) => {
    const { threadId, phase } = get()
    if (phase !== 'paused' || threadId == null) return
    clearPause()
    set({ phase: 'running' })
    req(command, { threadId }).catch((e: any) => log(`${command} failed: ${e.message}`))
  }

  return {
    phase: 'idle', projectId: null, projectPath: null, threads: [], threadId: null, stopReason: null,
    frames: [], frameId: null, scopes: [], vars: {}, verified: {}, output: [], error: null, canBreakNow: false,

    attach: async (projectId, projectPath) => {
      wire()
      bpIds.clear()
      if (get().phase !== 'idle') return
      set({ phase: 'connecting', projectId, projectPath, error: null, output: [], verified: {}, canBreakNow: false })
      try {
        caps = (await window.arw.debug.start()) ?? {}
        // monodbg finds the Editor via <project>/Library/EditorInstance.json.
        await req('attach', { name: 'Attach to Unity Editor', type: 'unity', request: 'attach', cwd: projectPath, debuggerOptions })
        if (get().phase === 'connecting') set({ phase: 'running' })
        try { const t = await req('threads'); set({ threads: t.threads ?? [] }) } catch { /* fine */ }
      } catch (e: any) {
        window.arw.debug.stop()
        const msg = String(e?.message ?? e)
        reset(/EditorInstance|Unity Editor running|determine port/i.test(msg)
          ? `Couldn't find a running Unity Editor for this project. Open it in Unity first. (${msg})`
          : msg)
      }
    },
    stop: () => {
      if (get().phase === 'idle') return
      window.arw.debug.stop()
      log('Debugger detached.')
      reset()
    },
    resume: () => step('continue'),
    pause: () => {
      const { phase, threads, threadId } = get()
      if (phase !== 'running') return
      req('pause', { threadId: threadId ?? threads[0]?.id ?? 0 }).catch((e: any) => log(`pause failed: ${e.message}`))
    },
    stepOver: () => step('next'),
    stepInto: () => step('stepIn'),
    stepOut: () => step('stepOut'),

    selectThread: async (threadId) => {
      if (get().phase !== 'paused') return
      set({ threadId, frames: [], frameId: null, scopes: [], vars: {} })
      await loadFrames(threadId)
    },
    selectFrame: async (frame) => {
      set({ frameId: frame.id, scopes: [], vars: {} })
      const path = frame.source?.path
      const pid = get().projectId
      if (path && pid) useIde.getState().openFile(pid, path, frame.line)
      try {
        const r = await req('scopes', { frameId: frame.id })
        const scopes: DapScope[] = r.scopes ?? []
        if (get().frameId !== frame.id) return
        set({ scopes })
        const first = scopes.find(s => !s.expensive)
        if (first) await get().loadVars(first.variablesReference)
      } catch (e: any) { log(`scopes failed: ${e.message}`) }
    },
    loadVars: async (ref) => {
      if (!ref || get().vars[ref]) return
      set((st) => ({ vars: { ...st.vars, [ref]: 'loading' } }))
      try {
        const r = await req('variables', { variablesReference: ref })
        set((st) => ({ vars: { ...st.vars, [ref]: r.variables ?? [] } }))
      } catch (e: any) {
        set((st) => ({ vars: { ...st.vars, [ref]: [{ name: 'error', value: e.message, variablesReference: 0 }] } }))
      }
    },
    evaluate: async (expression, context) => {
      const { phase, frameId } = get()
      if (phase !== 'paused') return null
      try {
        const r = await req('evaluate', { expression, frameId: frameId ?? undefined, context })
        return { result: r.result, type: r.type, variablesReference: r.variablesReference ?? 0 }
      } catch { return null }
    },
    syncBreakpoints: (path) => {
      const { phase, canBreakNow } = get()
      if (phase === 'idle' || !canBreakNow) return
      const lines = useIde.getState().breakpoints[fileKey(path)]?.lines ?? []
      void sendBreakpoints(path, lines)
    },
    clearError: () => set({ error: null })
  }
})

/** Current execution point (selected frame), for the editor's yellow line. */
export function executionPoint(st: DebugState): { key: string; line: number; top: boolean } | null {
  if (st.phase !== 'paused' || st.frameId == null) return null
  const f = st.frames.find(x => x.id === st.frameId)
  if (!f?.source?.path) return null
  return { key: fileKey(f.source.path), line: f.line, top: f.id === st.frames.find(x => x.source?.path)?.id }
}
