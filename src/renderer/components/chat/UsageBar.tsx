import React, { useEffect, useState } from 'react'
import { useChat } from '../../store/chatStore'
import type { ChatState, LimitWindow } from '@shared/chatModel'

const tokens = (n: number) => n >= 1e6 ? `${+(n / 1e6).toFixed(n % 1e6 ? 1 : 0)}M` : n >= 1000 ? `${(n / 1000).toFixed(n >= 1e5 ? 0 : 1)}k` : String(n)

/** "3:30pm" today, "Thu 2pm" later in the week. */
function resetLabel(epochS: number, now: number): string {
  const d = new Date(epochS * 1000)
  const h = d.getHours() % 12 || 12
  const time = `${h}${d.getMinutes() ? ':' + String(d.getMinutes()).padStart(2, '0') : ''}${d.getHours() < 12 ? 'am' : 'pm'}`
  const sameDay = new Date(now).toDateString() === d.toDateString()
  return sameDay ? time : `${d.toLocaleDateString(undefined, { weekday: 'short' })} ${time}`
}

const tone = (f: number) => (f >= 0.9 ? ' hot' : f >= 0.75 ? ' warm' : '')

function Meter({ label, title, win, now }: { label: string; title: string; win: LimitWindow | null; now: number }) {
  // Once the window has reset, the old reading says nothing about the new one.
  const live = win && (!win.resetsAt || win.resetsAt * 1000 > now)
  const pct = live ? Math.max(0, Math.min(100, Math.round(win.used * 100))) : null
  return (
    <span className="ub-item" title={title}>
      <span className="ub-label">{label}</span>
      <span className={`ub-meter${pct !== null ? tone(pct / 100) : ''}`}><i style={{ width: `${pct ?? 0}%` }} /></span>
      <span className="ub-val">{pct !== null ? `${pct}%` : '--'}</span>
      {live && win.resetsAt > 0 && <span className="ub-dim">· resets {resetLabel(win.resetsAt, now)}</span>}
    </span>
  )
}

/** Plan usage, context fill and cost under the chat composer — the chat's take on the terminal status line. */
export function UsageBar({ chat }: { chat: ChatState }) {
  const limits = useChat(s => s.limits)
  const [now, setNow] = useState(Date.now())

  // Re-read the status line's cache and re-evaluate reset times every 30s.
  useEffect(() => {
    void useChat.getState().refreshLimits()
    const t = setInterval(() => { setNow(Date.now()); void useChat.getState().refreshLimits() }, 30_000)
    return () => clearInterval(t)
  }, [])

  const ctx = chat.contextTokens
  const win = chat.contextWindow
  const ctxFrac = ctx != null && win ? ctx / win : null

  return (
    <div className="ub">
      <Meter label="Session" title="5-hour plan usage" win={limits?.fiveHour ?? null} now={now} />
      <span className="ub-sep" />
      <Meter label="Week" title="7-day plan usage" win={limits?.sevenDay ?? null} now={now} />
      <span className="ub-sep" />
      <span className="ub-item" title="Tokens in this conversation's context window">
        <span className="ub-label">Context</span>
        {ctxFrac !== null && <span className={`ub-meter small${tone(ctxFrac)}`}><i style={{ width: `${Math.min(100, ctxFrac * 100)}%` }} /></span>}
        <span className="ub-val">{ctx != null ? tokens(ctx) : '--'}</span>
        {win ? <span className="ub-dim">/ {tokens(win)}</span> : null}
      </span>
      <span className="ub-sep" />
      <span className="ub-item" title="Cost of this chat session so far">
        <span className="ub-label">Cost</span>
        <span className="ub-val cost">{chat.costUsd != null ? `$${chat.costUsd.toFixed(2)}` : '--'}</span>
      </span>
    </div>
  )
}
