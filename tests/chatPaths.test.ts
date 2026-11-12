import { describe, it, expect } from 'vitest'
import { resolveChatPath } from '@main/chatPaths'

const win = (p: string, cwd?: string) => resolveChatPath(p, cwd, 'C:\Users\me', 'win32')

describe('resolveChatPath (Windows)', () => {
  it('resolves absolute, home, Git Bash and relative paths', () => {
    expect(win('D:/PIROS/AI/ARWCode')).toBe('D:\PIROS\AI\ARWCode')
    expect(win('~/.codex/config.toml')).toBe('C:\Users\me\.codex\config.toml')
    expect(win('/c/Users/me/bin')).toBe('C:\Users\me\bin')
    expect(win('src/main/ipc.ts:42', 'D:\proj')).toBe('D:\proj\src\main\ipc.ts')
    expect(win('./a/b.json', 'D:\proj')).toBe('D:\proj\a\b.json')
    expect(win('`D:\x\y.cs:10:2`')).toBe('D:\x\y.cs')
  })
  it('gives up on a relative path with no folder to resolve it against', () => {
    expect(win('src/a.ts')).toBeNull()
    expect(win('')).toBeNull()
  })
})
