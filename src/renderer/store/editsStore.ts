import { create } from 'zustand'
import type { AgentEdit } from '@shared/agentEdits'
import { fileKey } from '../ide/paths'

/** Claude's unreviewed edits (main owns them; this is every window's live copy). */
interface EditsState {
  /** fileKey -> edit */
  edits: Record<string, AgentEdit>
  load: () => void
}

let started = false

export const useEdits = create<EditsState>((set) => ({
  edits: {},
  load: () => {
    if (started) return
    started = true
    window.arw.edits.onChanged(({ path, edit }) => set((s) => {
      const edits = { ...s.edits }
      if (edit) edits[fileKey(path)] = edit
      else delete edits[fileKey(path)]
      return { edits }
    }))
    void window.arw.edits.list().then((list) => set((s) => {
      const edits = { ...s.edits }
      for (const e of list) edits[fileKey(e.path)] ??= e
      return { edits }
    }))
  }
}))

export const editFor = (path: string | null) => (path ? useEdits.getState().edits[fileKey(path)] : undefined)
