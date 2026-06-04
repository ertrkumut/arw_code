# ARWCode

## MemStack Memory — DEFAULT (read this every session)

This project uses the **MemStack** SQLite memory plugin (`.claude/skills/`). Memory is
**always on** — recall at the start of work, capture as you go. No activation phrase needed.

DB CLI: `python .claude/skills/db/memstack-db.py <command>` (project key: `ARWCode`)

### On session start (recall)
1. If `.claude/session-context.md` exists, read it first — the SessionStart hook regenerates
   it each session with recent diary + observation summaries.
2. Restore prior state from the DB before acting on work that references earlier sessions:
   - `python .claude/skills/db/memstack-db.py get-context ARWCode`
   - `python .claude/skills/db/memstack-db.py get-sessions ARWCode`
   - `python .claude/skills/db/memstack-db.py get-insights ARWCode`
   - Keyword recall: `python .claude/skills/db/memstack-db.py search "<terms>"`

### During / end of work (capture)
- Record durable decisions, patterns, and bug fixes as insights:
  `python .claude/skills/db/memstack-db.py add-insight '{"project":"ARWCode","type":"decision","content":"...","context":"...","tags":"..."}'`
- Log a session diary entry summarizing what changed, decisions, and next steps:
  `python .claude/skills/db/memstack-db.py add-session '{"project":"ARWCode","accomplished":"...","decisions":"...","next_steps":"..."}'`
- Keep current state fresh: `set-context` (the SessionStart hook also auto-indexes this file).

## Rules
The MemStack rule set in `.claude/rules/` applies to this project. Most relevant:
- `rules/session-start.md` — diary-first context loading
- `rules/memstack.md` — commit format, build-before-push, no secrets in git
- `rules/echo.md` — explicit "recall / remember / what did we" queries
- `rules/memstack-mcp.md` — when to call the `memstack-skills` MCP (`find_skill` / `list_skills`)

Lifecycle hooks in `.claude/hooks/` fire automatically (SessionStart, Stop, PreCompact,
git pre-push/commit, secret scan). They are wired in `.claude/settings.json` — do not
follow deprecated skill protocols manually.
