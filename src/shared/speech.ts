/**
 * Voice mode text helpers: turning Claude's streamed markdown into speakable sentences,
 * and the hidden note that tells Claude it's in a spoken conversation.
 */

/** Wraps the instructions ARW adds to spoken prompts (stripped again when showing history). */
const VOICE_OPEN = '<arw-voice>'
const VOICE_CLOSE = '</arw-voice>'

const VOICE_RULES = [
  'Voice conversation: the user is talking to you out loud and hears your replies through text-to-speech.',
  'Talk like a sharp, friendly senior engineer on a call: natural spoken English, contractions, a bit of personality.',
  'Have a real discussion: think out loud, weigh options and trade-offs, say what you would pick and why, ask questions back, and push back when you disagree.',
  'Keep each turn short (a few sentences) so it stays a back-and-forth, unless they ask you to go deeper.',
  'Never read code, file paths, tables or bullet lists aloud: describe them in plain words. If code or a list really helps, put it in a fenced code block; it is shown on screen and not spoken.',
  'No markdown formatting, headings or emoji in what you say.',
  'You can still use your tools and do the work when they ask; tell them briefly what you are about to do.',
  'Their words come from speech recognition, so read past small transcription mistakes.'
].join(' ')

/** The prompt sent for something the user said (with a note if they cut Claude off). */
export function voicePrompt(spoken: string, cutOff?: string | null): string {
  const note = cutOff
    ? ` They interrupted you mid-reply; they heard you up to: "${cutOff.trim().slice(-280)}". Anything after that was not heard. React to what they say now.`
    : ''
  return `${VOICE_OPEN}${VOICE_RULES}${note}${VOICE_CLOSE}\n${spoken}`
}

/** Removes the voice note from a prompt (for showing it in the chat). */
export function stripVoiceNote(text: string): string {
  if (!text.startsWith(VOICE_OPEN)) return text
  const end = text.indexOf(VOICE_CLOSE)
  return end < 0 ? text : text.slice(end + VOICE_CLOSE.length).replace(/^\s+/, '')
}

/** Whisper's output for silence / noise ("[BLANK_AUDIO]", "(wind blowing)", "you"). */
export function isNoiseTranscript(text: string): boolean {
  const t = text.replace(/\[[^\]]*\]|\([^)]*\)|\*[^*]*\*/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim().toLowerCase()
  return !t || t === 'you' || t === 'bye'
}

const LIST_MARKER = /^\s*(?:[-*+•]|\d{1,3}[.)])\s+/

/** Heading / quote / list marker at the start of a markdown line. */
const stripLead = (s: string) => s.replace(/^\s*#{1,6}\s+/, '').replace(/^\s*>\s?/, '').replace(LIST_MARKER, '')

/** One piece of markdown prose → words a TTS voice can say. '' when nothing is speakable. */
export function speakable(text: string, lineStart = true): string {
  let s = lineStart ? stripLead(text) : text
  s = s
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')                       // images
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')                    // [text](url)
    .replace(/<[^>\s]+>/g, ' ')                                 // html-ish tags
    .replace(/`+([^`]*)`+/g, '$1')                              // inline code
    .replace(/https?:\/\/\S+/g, 'a link')
    // paths → their last part (src/main/foo.ts:42 → foo.ts)
    .replace(/(?:[A-Za-z]:)?(?:[\w@.~-]*[\\/])+([\w@.-]+)(?::\d+(?::\d+)?)?/g, '$1')
    .replace(/(\*\*|__)(.+?)\1/g, '$2')
    .replace(/(^|[^\w*])[*_]([^*_\n]+)[*_](?=[^\w*]|$)/g, '$1$2')
    .replace(/[*_~#]{2,}/g, '')
    .replace(/\s*(?:->|=>|→)\s*/g, ' to ')
    .replace(/\s*(?:<-|←)\s*/g, ' from ')
    .replace(/\p{Extended_Pictographic}️?/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
  return /[\p{L}\p{N}]/u.test(s) ? s : ''
}

/** Where a sentence ends: punctuation followed by whitespace (index just past the punctuation). */
const SENTENCE_END = /[.!?…]+["'”’)\]]*(?=\s)/g

/** Splits complete prose into sentences. */
function sentences(text: string): string[] {
  const out: string[] = []
  let from = 0
  for (const m of text.matchAll(SENTENCE_END)) {
    const end = m.index! + m[0].length
    const piece = text.slice(from, end).trim()
    if (piece) out.push(piece)
    from = end
  }
  const rest = text.slice(from).trim()
  if (rest) out.push(rest)
  return out
}

/** A long run with no sentence end is cut at a comma/semicolon so speech can start sooner. */
const MAX_RUN = 260

/**
 * Turns streamed markdown deltas into speakable sentences as soon as each one is complete.
 * Code fences, tables and rules are skipped (they're on screen, not read out).
 */
export class SpeechChunker {
  private raw = ''
  /** `raw` starts in the middle of a line (part of it was already spoken) */
  private midLine = false
  private inFence = false

  push(delta: string): string[] {
    this.raw += delta
    return this.drain(false)
  }

  /** End of a text block / turn: speak whatever is left. */
  flush(): string[] {
    const out = this.drain(true)
    this.reset()
    return out
  }

  reset() { this.raw = ''; this.midLine = false; this.inFence = false }

  private drain(final: boolean): string[] {
    const out: string[] = []
    let nl: number
    while ((nl = this.raw.indexOf('\n')) >= 0) {
      const line = this.raw.slice(0, nl)
      this.raw = this.raw.slice(nl + 1)
      this.line(line, !this.midLine, out)
      this.midLine = false
    }
    if (final) {
      if (this.raw) this.line(this.raw, !this.midLine, out)
      this.raw = ''
      return out
    }
    this.partial(out)
    return out
  }

  /** A complete line. */
  private line(line: string, lineStart: boolean, out: string[]) {
    const t = line.trim()
    if (lineStart && /^(```|~~~)/.test(t)) { this.inFence = !this.inFence; return }
    if (this.inFence) return
    if (lineStart && (t.startsWith('|') || /^([-*_])(\s*\1){2,}$/.test(t))) return
    for (const s of sentences(lineStart ? stripLead(line) : line)) this.emit(s, out)
  }

  /** The unfinished last line: speak its finished sentences now. */
  private partial(out: string[]) {
    if (this.inFence || !this.raw) return
    const lineStart = !this.midLine
    const head = this.raw.trimStart()
    // Could still become a fence, table or rule — wait for the rest of the line.
    if (lineStart && (/^[`~|]/.test(head) || /^[-*_]{1,3}$/.test(head.trim()))) return
    const skip = lineStart ? (LIST_MARKER.exec(this.raw)?.[0].length ?? 0) : 0
    let cut = -1
    for (const m of this.raw.slice(skip).matchAll(SENTENCE_END)) cut = skip + m.index! + m[0].length
    if (cut < 0 && this.raw.length - skip > MAX_RUN) {
      const window = this.raw.slice(skip, skip + MAX_RUN)
      const c = Math.max(window.lastIndexOf(', '), window.lastIndexOf('; '), window.lastIndexOf(' — '))
      cut = c > 80 ? skip + c + 1 : skip + window.lastIndexOf(' ')
      if (cut <= skip) return
    }
    if (cut < 0) return
    const done = this.raw.slice(0, cut)
    this.raw = this.raw.slice(cut)
    for (const s of sentences(lineStart ? stripLead(done) : done)) this.emit(s, out)
    this.midLine = true
  }

  private emit(s: string, out: string[]) {
    const text = speakable(s, false)
    if (text) out.push(text)
  }
}
