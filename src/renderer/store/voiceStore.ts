import { create } from 'zustand'

/**
 * Voice conversation state (one pane at a time). The engine in voice/engine.ts drives it;
 * the chat's voice controls read it.
 */
export type VoiceStatus =
  | 'off' | 'loading' | 'listening' | 'hearing' | 'transcribing' | 'thinking' | 'speaking' | 'error'

/** Kokoro voices offered in the picker (best-sounding ones first per accent). */
export const VOICES: { id: string; label: string }[] = [
  { id: 'bm_george', label: 'George · UK' },
  { id: 'bm_fable', label: 'Fable · UK' },
  { id: 'am_michael', label: 'Michael · US' },
  { id: 'am_puck', label: 'Puck · US' },
  { id: 'af_heart', label: 'Heart · US' },
  { id: 'af_bella', label: 'Bella · US' },
  { id: 'bf_emma', label: 'Emma · UK' }
]

interface VoiceStore {
  /** Pane the conversation is running in (null = voice off). */
  termId: string | null
  status: VoiceStatus
  /** First-run model download, 0..1 (null when not downloading). */
  progress: number | null
  error: string | null
  muted: boolean
  /** Claude's voice volume, 0..1 */
  volume: number
  voice: string
}

const PREFS_KEY = 'arw.voicePrefs'
const loadPrefs = (): { volume: number; voice: string } => {
  try {
    const p = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}')
    return {
      volume: typeof p.volume === 'number' ? Math.min(1, Math.max(0, p.volume)) : 0.85,
      voice: VOICES.some(v => v.id === p.voice) ? p.voice : VOICES[0].id
    }
  } catch { return { volume: 0.85, voice: VOICES[0].id } }
}
export const saveVoicePrefs = (p: { volume: number; voice: string }) => {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(p)) } catch { /* storage off */ }
}

export const useVoice = create<VoiceStore>(() => ({
  termId: null,
  status: 'off',
  progress: null,
  error: null,
  muted: false,
  ...loadPrefs()
}))
