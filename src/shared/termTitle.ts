/** Longest name we let an auto title take — the pane header is narrow. */
export const MAX_AUTO_NAME = 40

/** Default name addTerminal hands out ("terminal 3"). */
export const DEFAULT_NAME_RE = /^terminal \d+$/

/**
 * Turn the window title Claude Code sets (OSC 0/2) into a pane name, or null
 * when it carries nothing useful. Claude prefixes the summary with a spinner /
 * status glyph ("✳ Fix login bug", "⠂ Fix login bug") that changes every frame,
 * so strip leading non-text characters — that also keeps the name stable while
 * Claude works. The bare product title shown before the first prompt is ignored.
 */
export function cleanAgentTitle(raw: string): string | null {
  const t = raw.replace(/^[^\p{L}\p{N}]+/u, '').trim()
  if (!t || /^claude( code)?$/i.test(t)) return null
  return t.length > MAX_AUTO_NAME ? t.slice(0, MAX_AUTO_NAME - 1) + '…' : t
}
