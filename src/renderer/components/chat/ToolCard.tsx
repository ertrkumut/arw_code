import React, { useState } from 'react'
import type { ChatItem, DiffHunk } from '@shared/chatModel'
import { FileIcon } from '../FileIcons'
import { baseName } from '../../ide/paths'

type Tool = Extract<ChatItem, { kind: 'tool' }>

/** What a tool step says in its one-line summary, Antigravity-style ("Read Player.cs"). */
export function describeTool(t: Tool): { verb: string; target?: string; file?: string; extra?: string } {
  const i = t.input ?? {}
  const done = t.status !== 'running'
  const file: string | undefined = i.file_path ?? i.notebook_path ?? i.path
  switch (t.name) {
    case 'Read': return { verb: done ? 'Read' : 'Reading', file, target: file && baseName(file),
      extra: i.offset || i.limit ? `lines ${i.offset ?? 1}–${(i.offset ?? 1) + (i.limit ?? 0)}` : undefined }
    case 'Edit': case 'MultiEdit': case 'NotebookEdit': {
      const n = countPatch(t.patch)
      return { verb: done ? 'Edited' : 'Editing', file, target: file && baseName(file), extra: n ? `+${n.add} −${n.del}` : undefined }
    }
    case 'Write': return { verb: done ? 'Wrote' : 'Writing', file, target: file && baseName(file),
      extra: typeof i.content === 'string' ? `+${i.content.split('\n').length}` : undefined }
    case 'Bash': case 'PowerShell': return { verb: done ? 'Ran' : 'Running', target: firstLine(i.command ?? '') }
    case 'Grep': return { verb: done ? 'Searched' : 'Searching', target: i.pattern, extra: i.glob ?? i.path }
    case 'Glob': return { verb: done ? 'Found files' : 'Finding files', target: i.pattern }
    case 'WebFetch': return { verb: done ? 'Fetched' : 'Fetching', target: i.url }
    case 'WebSearch': return { verb: done ? 'Searched the web' : 'Searching the web', target: i.query }
    case 'Task': case 'Agent': return { verb: done ? 'Agent' : 'Agent working', target: i.description ?? i.subagent_type }
    case 'TodoWrite': return { verb: 'Updated plan' }
    case 'Skill': return { verb: 'Used skill', target: i.skill ?? i.name }
    default: {
      // mcp__server__tool → "server · tool"
      const m = /^mcp__(.+?)__(.+)$/.exec(t.name)
      return { verb: m ? `${m[1]} · ${m[2]}` : t.name }
    }
  }
}

const firstLine = (s: string) => { const l = s.split('\n')[0]; return l.length > 120 ? l.slice(0, 119) + '…' : l }

function countPatch(p?: DiffHunk[]) {
  if (!p?.length) return null
  let add = 0, del = 0
  for (const h of p) for (const l of h.lines) { if (l.startsWith('+')) add++; else if (l.startsWith('-')) del++ }
  return { add, del }
}

const ICONS: Record<string, string> = { Read: '◉', Edit: '✎', MultiEdit: '✎', Write: '✚', Bash: '›_', PowerShell: '›_', Grep: '⌕', Glob: '⌕',
  WebFetch: '⇣', WebSearch: '⌕', Task: '◈', Agent: '◈', TodoWrite: '☰', Skill: '✦' }

function Diff({ patch }: { patch: DiffHunk[] }) {
  return (
    <div className="ch-diff">
      {patch.map((h, i) => (
        <div key={i}>
          <div className="ch-diff-hunk">@@ −{h.oldStart},{h.oldLines} +{h.newStart},{h.newLines} @@</div>
          {h.lines.map((l, j) => (
            <div key={j} className={`ch-diff-line${l[0] === '+' ? ' add' : l[0] === '-' ? ' del' : ''}`}>
              <span className="ch-diff-sign">{l[0] === '+' || l[0] === '-' ? l[0] : ' '}</span>{l.slice(1) || ' '}
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

function Todos({ todos }: { todos: { content: string; status: string; activeForm?: string }[] }) {
  return (
    <div className="ch-todos">
      {todos.map((t, i) => (
        <div key={i} className={`ch-todo ${t.status}`}>
          <span className="ch-todo-box">{t.status === 'completed' ? '✓' : t.status === 'in_progress' ? '◐' : ''}</span>
          <span>{t.status === 'in_progress' && t.activeForm ? t.activeForm : t.content}</span>
        </div>
      ))}
    </div>
  )
}

/** One tool step. Expands to its details: diff, command output, search results, sub-steps. */
export function ToolCard({ tool, children, onOpenFile }: {
  tool: Tool
  /** sub-steps of an Agent/Task step */
  children?: Tool[]
  onOpenFile: (path: string) => void
}) {
  const d = describeTool(tool)
  const isTodo = tool.name === 'TodoWrite' && Array.isArray(tool.input?.todos)
  const [open, setOpen] = useState(false)
  const expandable = !isTodo && (!!tool.patch?.length || !!tool.result || !!children?.length || tool.name === 'Bash' || tool.name === 'PowerShell')

  return (
    <div className={`ch-tool ${tool.status}${open ? ' open' : ''}`}>
      <div className="ch-tool-row" onClick={() => expandable && setOpen(!open)}>
        <span className="ch-tool-ico">{tool.status === 'running' ? <span className="ch-spin" /> : ICONS[tool.name] ?? '•'}</span>
        <span className="ch-tool-verb">{d.verb}</span>
        {d.file ? (
          <span className="ch-tool-file" title={`${d.file}\nClick to open in the IDE`}
            onClick={(e) => { e.stopPropagation(); onOpenFile(d.file!) }}>
            <FileIcon name={d.target ?? d.file} /><span>{d.target}</span>
          </span>
        ) : d.target ? <span className="ch-tool-target" title={d.target}>{d.target}</span> : null}
        {d.extra && <span className={`ch-tool-extra${/^\+\d+ −\d+$/.test(d.extra) ? ' diffstat' : ''}`}>{d.extra}</span>}
        {children && children.length > 0 && <span className="ch-tool-extra">{children.length} step{children.length > 1 ? 's' : ''}</span>}
        {tool.status === 'error' && <span className="ch-tool-err">failed</span>}
        {expandable && <span className="ch-tool-chev">{open ? '▾' : '▸'}</span>}
      </div>
      {isTodo && <Todos todos={tool.input.todos} />}
      {open && (
        <div className="ch-tool-body">
          {(tool.name === 'Bash' || tool.name === 'PowerShell') && <pre className="ch-cmd">{tool.input?.command}</pre>}
          {tool.patch?.length ? <Diff patch={tool.patch} />
            : children?.length ? (
              <div className="ch-substeps">
                {children.map(c => <ToolCard key={c.id} tool={c} onOpenFile={onOpenFile} />)}
              </div>
            ) : tool.result ? <pre className="ch-out">{tool.result.length > 20000 ? tool.result.slice(0, 20000) + '\n…' : tool.result}</pre> : null}
        </div>
      )}
    </div>
  )
}
