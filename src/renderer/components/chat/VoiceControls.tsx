import React, { useEffect } from 'react'
import { useVoice, VOICES, type VoiceStatus } from '../../store/voiceStore'
import { voice } from '../../voice/engine'

const STATUS_TEXT: Record<VoiceStatus, string> = {
  off: '',
  loading: 'Loading voice…',
  listening: 'Listening',
  hearing: 'Hearing you…',
  transcribing: 'Got it…',
  thinking: 'Thinking…',
  speaking: 'Speaking · just talk to interrupt',
  error: 'Voice error'
}

const WaveIcon = () => (
  <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
    <path d="M2 7v2M5 5v6M8 2.5v11M11 5v6M14 7v2" />
  </svg>
)
const MicIcon = ({ off }: { off: boolean }) => (
  <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <rect x="5.5" y="1.75" width="5" height="8" rx="2.5" />
    <path d="M3 7.5a5 5 0 0 0 10 0M8 12.5v2" />
    {off && <path d="M2.5 2l11 12" />}
  </svg>
)
const SpeakerIcon = ({ level }: { level: number }) => (
  <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M2.5 6h2.5l3.5-3v10l-3.5-3H2.5z" />
    {level > 0 && <path d="M10.75 6a2.75 2.75 0 0 1 0 4" />}
    {level > 0.5 && <path d="M12.5 4.25a5.25 5.25 0 0 1 0 7.5" />}
    {level === 0 && <path d="M11 6.25l3.5 3.5M14.5 6.25L11 9.75" />}
  </svg>
)

/** Voice on/off, mic mute and Claude's volume, in the chat's input bar. */
export function VoiceControls({ termId, who }: { termId: string; who: string }) {
  const active = useVoice(s => s.termId === termId)
  const muted = useVoice(s => s.muted)
  const volume = useVoice(s => s.volume)
  const voiceId = useVoice(s => s.voice)

  // Closing the pane ends its conversation.
  useEffect(() => () => { if (voice.isActive(termId)) voice.stop() }, [termId])

  return (
    <div className={`ch-voice${active ? ' on' : ''}`}>
      {active && (
        <>
          <button className={`ch-vbtn${muted ? ' muted' : ''}`} title={muted ? 'Unmute mic' : 'Mute mic'}
            onClick={() => voice.setMuted(!muted)}>
            <MicIcon off={muted} />
          </button>
          <div className="ch-vol" title={`${who}'s volume · ${Math.round(volume * 100)}%`}>
            <button className="ch-vbtn" onClick={() => voice.setVolume(volume > 0 ? 0 : 0.85)}>
              <SpeakerIcon level={volume} />
            </button>
            <input type="range" min={0} max={1} step={0.01} value={volume}
              style={{ '--v': `${volume * 100}%` } as React.CSSProperties}
              onChange={(e) => voice.setVolume(Number(e.target.value))} />
          </div>
          <select className="ch-vsel" value={voiceId} title="Voice" onChange={(e) => voice.setVoice(e.target.value)}>
            {VOICES.map(v => <option key={v.id} value={v.id}>{v.label}</option>)}
          </select>
        </>
      )}
      <button className={`ch-vbtn ch-vtoggle${active ? ' on' : ''}`}
        title={active ? 'Turn voice conversation off' : `Talk with ${who} (voice conversation)`}
        onClick={() => void voice.toggle(termId)}>
        <WaveIcon />
      </button>
    </div>
  )
}

/** One line above the prompt box while voice is on: what's happening right now. */
export function VoiceStatusLine({ termId }: { termId: string }) {
  const active = useVoice(s => s.termId === termId)
  const status = useVoice(s => s.status)
  const progress = useVoice(s => s.progress)
  const error = useVoice(s => s.error)
  const muted = useVoice(s => s.muted)
  if (!active) return null
  if (status === 'error') return (
    <div className="ch-vstatus err">
      <span>{error ?? 'Voice stopped'}</span>
      <button onClick={() => voice.stop()}>Dismiss</button>
    </div>
  )
  const text = status === 'loading' && progress != null
    ? `Downloading voice models (one time) · ${Math.round(progress * 100)}%`
    : muted && (status === 'listening' || status === 'hearing') ? 'Mic muted' : STATUS_TEXT[status]
  return (
    <div className={`ch-vstatus s-${muted && status === 'listening' ? 'muted' : status}`}>
      <span className="ch-vdot" />
      <span>{text}</span>
      {status === 'loading' && progress != null && <span className="ch-vbar"><i style={{ width: `${progress * 100}%` }} /></span>}
      {status === 'speaking' && <button onClick={() => voice.hush()}>Skip</button>}
    </div>
  )
}
