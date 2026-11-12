import { describe, it, expect } from 'vitest'
import { findPaths, wholeCodePath, splitPaths } from '@shared/pathLinks'

const paths = (t: string) => findPaths(t).map(h => h.path)
const linked = (t: string) => findPaths(t).map(h => t.slice(h.start, h.end))

describe('findPaths', () => {
  it('finds Windows, home, POSIX and relative paths', () => {
    expect(paths('Installer: D:\\PIROS\\AI\\ARWCode\\dist\\ARWCode-Setup.exe')).toEqual(['D:\\PIROS\\AI\\ARWCode\\dist\\ARWCode-Setup.exe'])
    expect(paths('open D:/PIROS/AI and C:\\Users\\hopec\\')).toEqual(['D:/PIROS/AI', 'C:\\Users\\hopec\\'])
    expect(paths('config in ~/.codex/config.toml')).toEqual(['~/.codex/config.toml'])
    expect(paths('cd /c/Users/hopec/bin')).toEqual(['/c/Users/hopec/bin'])
    expect(paths('see src/main/ipc.ts and ./tests/a.test.ts')).toEqual(['src/main/ipc.ts', './tests/a.test.ts'])
    expect(paths('rules live in .claude/rules/echo.md')).toEqual(['.claude/rules/echo.md'])
    expect(paths('the src/renderer/ folder')).toEqual(['src/renderer/'])
  })

  it('keeps a line suffix in the link but not the path, and drops trailing punctuation', () => {
    const t = 'Fixed in src/main/codexChat.ts:42, see (D:\\x\\y.cs).'
    expect(paths(t)).toEqual(['src/main/codexChat.ts', 'D:\\x\\y.cs'])
    expect(linked(t)).toEqual(['src/main/codexChat.ts:42', 'D:\\x\\y.cs'])
    expect(paths('Edit `D:\\a\\b.ts:10:3`')).toEqual(['D:\\a\\b.ts'])
  })

  it('ignores things that only look a bit like paths', () => {
    for (const t of ['and/or', 'ChatView.tsx', '1/2 done', '/review my code', 'use @types/node', 'on 2026/11/12',
      'https://github.com/openai/codex/blob/main/README.md', 'drive C: only', 'C:\\ alone', 'node_modules/@openai/codex'])
      expect(paths(t), t).toEqual([])
  })

  it('splits text into plain and path pieces', () => {
    expect(splitPaths('a src/x.ts b')).toEqual([{ text: 'a ' }, { text: 'src/x.ts', path: 'src/x.ts' }, { text: ' b' }])
  })
})

describe('wholeCodePath', () => {
  it('accepts an absolute path with spaces only as a whole code span', () => {
    expect(wholeCodePath('C:\\Program Files\\nodejs\\node.exe')).toBe('C:\\Program Files\\nodejs\\node.exe')
    expect(wholeCodePath('D:\\PIROS\\AI\\ARWCode\\dist\\ARWCode Setup 2.0.3.exe')).toBe('D:\\PIROS\\AI\\ARWCode\\dist\\ARWCode Setup 2.0.3.exe')
    expect(wholeCodePath('npm run build')).toBeNull()
    expect(wholeCodePath('git diff HEAD/foo')).toBeNull()
  })
})
