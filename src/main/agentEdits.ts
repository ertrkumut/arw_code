import { readFile } from 'fs/promises'
import { baselineFromPatch, sameText, type AgentEdit } from '@shared/agentEdits'

/** Same normalization as the renderer's fileKey (ide/paths.ts) on Windows. */
const keyOf = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()

/**
 * Files Claude edited from a chat pane that haven't been reviewed yet, with their
 * pre-edit text. Fed by the Edit/Write tool results Claude prints; the IDE windows show
 * the diff and send back accepts (new baseline) and full accepts/rejects (dropped).
 */
export class AgentEditTracker {
  private files = new Map<string, AgentEdit>()
  private queue: Promise<void> = Promise.resolve()

  constructor(private notify: (path: string, edit: AgentEdit | null) => void) {}

  list(): AgentEdit[] { return [...this.files.values()] }

  /** A chat event; tool results of file edits start tracking that file. */
  noteEvent(ev: any): void {
    if (ev?.type !== 'user') return
    const r = ev.tool_use_result ?? ev.toolUseResult
    if (!r || typeof r !== 'object' || typeof r.filePath !== 'string') return
    if (!Array.isArray(r.structuredPatch) && r.type !== 'create') return
    // One at a time, so a quick second edit can't read the file before the first is noted.
    this.queue = this.queue.then(() => this.note(r)).catch(() => {})
  }

  private async note(r: any): Promise<void> {
    const path: string = r.filePath
    const k = keyOf(path)
    if (this.files.has(k)) return                // keep the oldest unreviewed baseline
    let current: string
    try { current = (await readFile(path, 'utf8')).replace(/^﻿/, '') } catch { return }
    let baseline: string | null = null
    let created = false
    if (r.type === 'create') { baseline = ''; created = true }
    else if (Array.isArray(r.structuredPatch) && r.structuredPatch.length) baseline = baselineFromPatch(current, r.structuredPatch)
    if (baseline === null && typeof r.originalFile === 'string') baseline = r.originalFile.replace(/^﻿/, '')
    if (baseline === null || (!created && sameText(baseline, current))) return
    const edit: AgentEdit = { path, baseline, ...(created ? { created } : {}) }
    this.files.set(k, edit)
    this.notify(path, edit)
  }

  /** From an IDE window: a new baseline (some changes accepted) or null (file fully reviewed). */
  set(path: string, baseline: string | null): void {
    const k = keyOf(path)
    const cur = this.files.get(k)
    if (baseline === null) {
      if (!cur) return
      this.files.delete(k)
      this.notify(path, null)
      return
    }
    const edit: AgentEdit = { path: cur?.path ?? path, baseline, ...(cur?.created ? { created: true } : {}) }
    this.files.set(k, edit)
    this.notify(edit.path, edit)
  }
}
