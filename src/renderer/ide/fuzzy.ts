import { baseName } from './paths'

/** Fuzzy score: every query char must appear in order. Name matches beat path matches,
 *  consecutive and word-start hits score higher. -1 = no match. */
export function fuzzyScore(query: string, rel: string): number {
  if (!query) return 0
  const q = query.toLowerCase()
  const name = baseName(rel).toLowerCase()
  const scoreIn = (text: string) => {
    let ti = 0, score = 0, streak = 0
    for (const ch of q) {
      const idx = text.indexOf(ch, ti)
      if (idx < 0) return -1
      const wordStart = idx === 0 || /[/._\-\s]/.test(text[idx - 1]) || (text[idx] !== text[idx].toLowerCase())
      streak = idx === ti ? streak + 1 : 0
      score += 1 + streak * 2 + (wordStart ? 3 : 0)
      ti = idx + 1
    }
    return score - text.length * 0.01
  }
  const n = scoreIn(name)
  if (n >= 0) return n + 100 + (name.startsWith(q) ? 50 : 0)
  return scoreIn(rel.toLowerCase())
}
