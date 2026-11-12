import { homedir } from 'os'
import { isAbsolute, join, normalize, win32 } from 'path'

/**
 * A path as written in a chat → an absolute path on this machine, or null.
 *   ~/x            → <home>/x
 *   /c/Users/x     → C:\Users\x on Windows (Git Bash / MSYS form)
 *   src/a.ts       → <cwd>/src/a.ts
 * Any ":line[:col]" suffix is dropped.
 */
export function resolveChatPath(p: string, cwd?: string, home = homedir(), platform = process.platform): string | null {
  let s = String(p ?? '').trim().replace(/^["'`]|["'`]$/g, '').replace(/(:\d+){1,2}$/, '')
  if (!s) return null
  if (/^~([\\/]|$)/.test(s)) s = join(home, s.slice(1))
  else if (platform === 'win32' && /^\/[a-z](\/|$)/i.test(s)) s = `${s[1].toUpperCase()}:\\${s.slice(3)}`
  const abs = platform === 'win32' ? win32.isAbsolute(s) && /^([A-Za-z]:|\\\\)/.test(s) : isAbsolute(s)
  if (!abs) {
    if (!cwd) return null
    s = join(cwd, s)
  }
  return platform === 'win32' ? win32.normalize(s) : normalize(s)
}
