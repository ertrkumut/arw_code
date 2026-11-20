import type { MicVAD } from '@ricky0123/vad-web'
import { SpeechChunker, voicePrompt, isNoiseTranscript } from '@shared/speech'
import { useVoice, saveVoicePrefs, type VoiceStatus } from '../store/voiceStore'
import { useChat } from '../store/chatStore'
import { useApp } from '../store/appStore'

/**
 * Voice conversation with a chat pane, all on this machine:
 *
 *   mic ─ Silero VAD ─ (you stop talking) ─ Moonshine ─ prompt ─▶ Claude
 *   Claude's streamed reply ─ SpeechChunker (sentences) ─ Kokoro ─ speakers
 *
 * Talking while Claude speaks cuts it off: playback stops, the turn is interrupted, and the
 * next prompt tells Claude how far it got. The mic and VAD live here; Moonshine and Kokoro
 * run natively in a separate process (main/voiceHost.ts) that exists only while voice is
 * on. Models download once (~400 MB) into userData/voice-models.
 */

/** Where the VAD files are served from (copied there at build time). */
const assetBase = () => new URL('voice/', document.baseURI).href

/** VAD sensitivity: normal, and stricter while Claude talks so its own voice doesn't count. */
const LISTEN = { positiveSpeechThreshold: 0.5, negativeSpeechThreshold: 0.35 }
const WHILE_SPEAKING = { positiveSpeechThreshold: 0.8, negativeSpeechThreshold: 0.5 }

interface Job { id: number; text: string; audio: AudioBuffer | null }

class VoiceEngine {
  private termId: string | null = null
  /** Bumped on every start/stop so stale async work can tell it's obsolete. */
  private session = 0
  /** Voice process connected and loaded. */
  private host = false
  private offHost: (() => void) | null = null
  private vad: MicVAD | null = null
  private ctx: AudioContext | null = null
  private gain: GainNode | null = null
  private offEvents: (() => void) | null = null
  private downloads = new Map<string, { loaded: number; total: number }>()

  // Speaking
  /** Bumped when speech is cancelled; older TTS results are dropped. */
  private gen = 1
  private nextId = 1
  private jobs: Job[] = []
  private source: AudioBufferSourceNode | null = null
  private playStart = 0
  private chunker = new SpeechChunker()

  // Turn tracking
  private turnBusy = false
  /** The user cut this turn off: don't speak the rest of it. */
  private ignoreTurn = false
  /** Text deltas arrived since the last full `assistant` event (so don't speak it twice). */
  private streamed = false
  /** Sentences spoken in full this turn. */
  private heard: string[] = []
  /** What the user heard before interrupting (sent with their next prompt). */
  private cutOff: string | null = null
  private hearing = false
  private transcribing = 0
  private sttWaiters = new Map<number, (text: string) => void>()

  isActive(termId: string) { return this.termId === termId }

  async toggle(termId: string) {
    if (this.termId === termId) return this.stop()
    return this.start(termId)
  }

  async start(termId: string) {
    if (this.termId) this.stop()
    const session = ++this.session
    this.termId = termId
    this.set({ termId, status: 'loading', error: null, progress: null, muted: false })
    try {
      this.ctx = new AudioContext()
      this.gain = this.ctx.createGain()
      this.gain.gain.value = useVoice.getState().volume
      this.gain.connect(this.ctx.destination)

      await this.loadModels(session)
      if (session !== this.session) return

      // Loaded on first use so the app doesn't carry the ONNX runtime at startup.
      const { MicVAD } = await import('@ricky0123/vad-web')
      if (session !== this.session) return
      this.vad = await MicVAD.new({
        model: 'v5',
        baseAssetPath: assetBase() + 'vad/',
        onnxWASMBasePath: assetBase() + 'vad/',
        ...LISTEN,
        redemptionMs: 900,          // this much silence ends your turn
        minSpeechMs: 300,
        preSpeechPadMs: 400,
        startOnLoad: false,
        onSpeechStart: () => this.onSpeechStart(),
        onSpeechRealStart: () => this.onSpeechRealStart(),
        onVADMisfire: () => { this.hearing = false; this.refresh() },
        onSpeechEnd: (audio) => { void this.onSpeechEnd(audio, session) }
      })
      if (session !== this.session) { void this.vad.destroy(); return }

      this.offEvents = window.arw.chat.onEvent(({ id, event }) => { if (id === this.termId) this.onChatEvent(event) })
      if (!useVoice.getState().muted) await this.vad.start()
      this.set({ progress: null })
      this.refresh()
    } catch (e: any) {
      if (session !== this.session) return
      const msg = e?.name === 'NotAllowedError' || e?.name === 'NotFoundError'
        ? 'No microphone access. Check Windows Settings → Privacy → Microphone.'
        : String(e?.message ?? e)
      this.teardown()
      this.set({ status: 'error', error: msg, progress: null })
    }
  }

  stop() {
    this.session++
    this.teardown()
    this.set({ termId: null, status: 'off', progress: null, error: null, muted: false })
  }

  private teardown() {
    this.cancelSpeech()
    this.offEvents?.(); this.offEvents = null
    void this.vad?.destroy(); this.vad = null
    this.offHost?.(); this.offHost = null
    if (this.host || this.session) window.arw.voice.stop()
    this.host = false
    void this.ctx?.close().catch(() => {}); this.ctx = null; this.gain = null
    for (const w of this.sttWaiters.values()) w('')
    this.sttWaiters.clear()
    this.termId = null
    this.turnBusy = this.ignoreTurn = this.streamed = this.hearing = false
    this.transcribing = 0
    this.heard = []
    this.cutOff = null
    this.downloads.clear()
  }

  setMuted(muted: boolean) {
    this.set({ muted })
    if (!this.vad) return
    if (muted) { void this.vad.pause(); this.hearing = false } else void this.vad.start()
    this.refresh()
  }

  setVolume(volume: number) {
    const v = Math.min(1, Math.max(0, volume))
    this.set({ volume: v })
    if (this.gain && this.ctx) this.gain.gain.setTargetAtTime(v, this.ctx.currentTime, 0.02)
    saveVoicePrefs({ volume: v, voice: useVoice.getState().voice })
  }

  setVoice(voice: string) {
    this.set({ voice })
    saveVoicePrefs({ volume: useVoice.getState().volume, voice })
  }

  /** Stop talking now (e.g. the stop button). */
  hush() {
    this.cancelSpeech()
    this.refresh()
  }

  // ── models ──────────────────────────────────────────────────────────────

  private loadModels(session: number): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.offHost = window.arw.voice.onEvent((m) => {
        if (session !== this.session) return
        if (m.type === 'progress') this.onDownload(m.file, m.loaded, m.total)
        else if (m.type === 'ready') { this.host = true; resolve() }
        else if (m.type === 'error' && m.id == null) {
          if (!this.host) reject(new Error(m.message))
          else { this.teardown(); this.set({ status: 'error', error: m.message, progress: null }) }
        } else if (m.type === 'text' || (m.type === 'error' && m.id != null)) this.onSttMessage(m)
        if (m.type === 'audio' || (m.type === 'error' && m.id != null)) this.onTtsMessage(m)
      })
      window.arw.voice.start(useVoice.getState().voice).catch(reject)
    })
  }

  private onDownload(file: string, loaded: number, total: number) {
    this.downloads.set(file, { loaded, total })
    let l = 0, t = 0
    for (const d of this.downloads.values()) { l += d.loaded; t += d.total }
    // Tiny config files finish first; only show a bar while something big is coming.
    if (t > 5_000_000) this.set({ progress: Math.min(1, l / t) })
  }

  // ── listening ───────────────────────────────────────────────────────────

  private onSpeechStart() {
    this.hearing = true
    if (!this.isSpeaking()) this.refresh()
  }

  /** Real speech (not a blip). If Claude is talking, that's an interruption. */
  private onSpeechRealStart() {
    this.hearing = true
    if (this.isSpeaking()) this.bargeIn()
    this.refresh()
  }

  private async onSpeechEnd(audio: Float32Array, session: number) {
    this.hearing = false
    if (!this.host || !this.termId) return
    this.transcribing++
    this.refresh()
    const id = this.nextId++
    const text = await new Promise<string>((resolve) => {
      this.sttWaiters.set(id, resolve)
      window.arw.voice.send({ type: 'transcribe', id, audio })
    })
    this.transcribing = Math.max(0, this.transcribing - 1)
    if (session !== this.session || !this.termId) return
    if (!text || isNoiseTranscript(text)) { this.refresh(); return }
    this.send(this.termId, text)
  }

  private onSttMessage(m: any) {
    if (m.type === 'text' || (m.type === 'error' && m.id != null)) {
      if (m.type === 'error') console.warn('[voice]', m.message)
      const w = this.sttWaiters.get(m.id)
      this.sttWaiters.delete(m.id)
      w?.(m.type === 'text' ? m.text : '')
    }
  }

  private send(termId: string, text: string) {
    const prompt = voicePrompt(text, this.cutOff)
    this.cutOff = null
    useApp.getState().namePaneFromPrompt(termId, text)
    window.arw.chat.send(termId, [{ type: 'text', text: prompt }], { text, images: [] })
    this.turnBusy = true
    this.refresh()
  }

  /** The user started talking over Claude. */
  private bargeIn() {
    const partial = this.partialSentence()
    const said = [...this.heard, partial].filter(Boolean).join(' ').trim()
    if (said) this.cutOff = said
    this.cancelSpeech()
    if (this.turnBusy && this.termId) {
      this.ignoreTurn = true
      useChat.getState().interrupt(this.termId)
    }
  }

  /** The words of the sentence playing now that have been said (estimated from time). */
  private partialSentence(): string {
    const job = this.jobs[0]
    if (!this.source || !job?.audio || !this.ctx) return ''
    const frac = Math.min(1, Math.max(0, (this.ctx.currentTime - this.playStart) / job.audio.duration))
    const words = job.text.split(/\s+/)
    const n = Math.round(frac * words.length)
    return n ? words.slice(0, n).join(' ') + (n < words.length ? '…' : '') : ''
  }

  // ── Claude's side ───────────────────────────────────────────────────────

  private onChatEvent(ev: any) {
    if (!ev || typeof ev !== 'object') return
    const sub = !!(ev.parent_tool_use_id ?? ev.parentToolUseID)
    switch (ev.type) {
      case 'arw_user':
        // A new prompt (spoken or typed): start a fresh reply.
        this.turnBusy = true
        this.ignoreTurn = false
        this.streamed = false
        this.heard = []
        this.chunker.reset()
        this.refresh()
        return
      case 'stream_event': {
        if (sub || this.ignoreTurn) return
        const e = ev.event ?? {}
        if (e.type === 'content_block_delta' && e.delta?.type === 'text_delta') {
          this.streamed = true
          this.say(this.chunker.push(e.delta.text ?? ''))
        } else if (e.type === 'content_block_stop') this.say(this.chunker.flush())
        return
      }
      case 'assistant': {
        if (sub || this.ignoreTurn) return
        // Agents that don't stream (Codex) only send finished text blocks.
        if (!this.streamed) {
          for (const b of ev.message?.content ?? []) if (b?.type === 'text' && b.text) this.say(this.chunker.push(b.text + '\n'))
          this.say(this.chunker.flush())
        }
        this.streamed = false
        return
      }
      case 'result':
      case 'arw_exit':
        if (!this.ignoreTurn) this.say(this.chunker.flush())
        this.turnBusy = false
        this.ignoreTurn = false
        this.refresh()
        return
    }
  }

  private say(chunks: string[]) {
    if (!this.host || !chunks.length) return
    const { voice } = useVoice.getState()
    for (const text of chunks) {
      const job: Job = { id: this.nextId++, text, audio: null }
      this.jobs.push(job)
      window.arw.voice.send({ type: 'speak', id: job.id, gen: this.gen, text, voice })
    }
    this.vad?.setOptions(WHILE_SPEAKING)
    this.refresh()
  }

  private onTtsMessage(m: any) {
    if (m.type === 'audio') {
      if (m.gen !== this.gen || !this.ctx) return
      const job = this.jobs.find(j => j.id === m.id)
      if (!job) return
      const buf = this.ctx.createBuffer(1, m.audio.length, m.sampleRate)
      buf.copyToChannel(m.audio, 0)
      job.audio = buf
      this.pump()
    } else if (m.type === 'error' && m.id != null) {
      console.warn('[voice]', m.message)
      this.jobs = this.jobs.filter(j => j.id !== m.id)
      this.pump()
      this.refresh()
    }
  }

  /** Play the next sentence once it's ready (in order). */
  private pump() {
    if (this.source || !this.ctx || !this.gain) return
    const job = this.jobs[0]
    if (!job?.audio) return
    if (this.ctx.state === 'suspended') void this.ctx.resume()
    const src = this.ctx.createBufferSource()
    src.buffer = job.audio
    src.connect(this.gain)
    src.onended = () => {
      if (this.source !== src) return
      this.source = null
      this.heard.push(job.text)
      this.jobs.shift()
      this.pump()
      this.refresh()
    }
    this.source = src
    this.playStart = this.ctx.currentTime
    src.start()
    this.refresh()
  }

  private cancelSpeech() {
    this.gen++
    if (this.host) window.arw.voice.send({ type: 'cancel', gen: this.gen })
    const src = this.source
    this.source = null
    try { src?.stop() } catch { /* not started */ }
    this.jobs = []
    this.chunker.reset()
  }

  private isSpeaking() { return !!this.source || this.jobs.length > 0 }

  /** Work out the status from what's going on right now. */
  private refresh() {
    if (!this.termId) return
    const st = useVoice.getState()
    if (st.status === 'loading' && !this.vad) return
    const speaking = this.isSpeaking()
    if (!speaking) this.vad?.setOptions(LISTEN)
    const status: VoiceStatus = this.hearing && !speaking && !st.muted ? 'hearing'
      : speaking ? 'speaking'
      : this.transcribing ? 'transcribing'
      : this.turnBusy ? 'thinking'
      : 'listening'
    if (status !== st.status) this.set({ status })
  }

  private set(p: Partial<ReturnType<typeof useVoice.getState>>) { useVoice.setState(p) }
}

export const voice = new VoiceEngine()
