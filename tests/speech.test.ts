import { describe, it, expect } from 'vitest'
import { SpeechChunker, speakable, voicePrompt, stripVoiceNote, isNoiseTranscript } from '../src/shared/speech'

/** Feed text in small deltas, the way Claude streams it. */
function stream(text: string, size = 3): string[] {
  const c = new SpeechChunker()
  const out: string[] = []
  for (let i = 0; i < text.length; i += size) out.push(...c.push(text.slice(i, i + size)))
  out.push(...c.flush())
  return out
}

describe('speakable', () => {
  it('drops markdown and keeps the words', () => {
    expect(speakable('## The **plan** is _simple_')).toBe('The plan is simple')
    expect(speakable('- put it in `useVoice`')).toBe('put it in useVoice')
    expect(speakable('See [the docs](https://x.y/z) or https://a.b/c')).toBe('See the docs or a link')
  })
  it('reads paths as their file name', () => {
    expect(speakable('Edit src/renderer/voice/engine.ts:42 first')).toBe('Edit engine.ts first')
    expect(speakable('in D:\\PIROS\\AI\\app.tsx')).toBe('in app.tsx')
  })
  it('turns arrows into words and drops emoji', () => {
    expect(speakable('mic → whisper → claude 🚀')).toBe('mic to whisper to claude')
  })
  it('returns empty for nothing speakable', () => {
    expect(speakable('---')).toBe('')
    expect(speakable('**')).toBe('')
  })
})

describe('SpeechChunker', () => {
  it('emits each sentence as soon as it is complete', () => {
    const c = new SpeechChunker()
    expect(c.push('Okay, so I think we')).toEqual([])
    expect(c.push(' should split it. The')).toEqual(['Okay, so I think we should split it.'])
    expect(c.push(' engine stays small')).toEqual([])
    expect(c.flush()).toEqual(['The engine stays small'])
  })
  it('gives the same result however the text is chunked', () => {
    const text = 'First thing. Second thing! Is that right?\nNew line here.'
    const want = ['First thing.', 'Second thing!', 'Is that right?', 'New line here.']
    expect(stream(text, 1)).toEqual(want)
    expect(stream(text, 7)).toEqual(want)
    expect(stream(text, 1000)).toEqual(want)
  })
  it('skips code blocks and tables', () => {
    const text = 'Here is the idea.\n```ts\nconst a = 1. b = 2\n```\n| a | b |\n|---|---|\nThat is it.'
    expect(stream(text, 4)).toEqual(['Here is the idea.', 'That is it.'])
  })
  it('does not read list numbers as sentences', () => {
    expect(stream('1. Load the models. Then wait.\n2. Start the mic\n', 2))
      .toEqual(['Load the models.', 'Then wait.', 'Start the mic'])
  })
  it('cuts a very long run at a comma so speech can start', () => {
    const c = new SpeechChunker()
    const long = 'word '.repeat(30) + 'and then, ' + 'more '.repeat(40)
    const out = c.push(long)
    expect(out.length).toBe(1)
    expect(out[0].endsWith('and then,')).toBe(true)
  })
})

describe('voice prompt', () => {
  it('wraps and unwraps the spoken text', () => {
    const p = voicePrompt('what about caching?')
    expect(p).toContain('<arw-voice>')
    expect(stripVoiceNote(p)).toBe('what about caching?')
  })
  it('tells Claude where it was cut off', () => {
    expect(voicePrompt('wait', 'I would use a worker so')).toContain('heard you up to: "I would use a worker so"')
  })
  it('leaves normal prompts alone', () => {
    expect(stripVoiceNote('hello <arw-voice>')).toBe('hello <arw-voice>')
  })
})

describe('isNoiseTranscript', () => {
  it('spots whisper noise', () => {
    expect(isNoiseTranscript(' [BLANK_AUDIO]')).toBe(true)
    expect(isNoiseTranscript('(wind blowing)')).toBe(true)
    expect(isNoiseTranscript(' you')).toBe(true)
    expect(isNoiseTranscript('Use a worker.')).toBe(false)
  })
})
