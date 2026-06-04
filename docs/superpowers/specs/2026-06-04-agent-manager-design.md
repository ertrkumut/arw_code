# Agent Manager — Design Spec

**Date:** 2026-06-04
**Status:** Approved (brainstorming complete)
**Working dir:** `D:\PIROS\AI\ARWCode`

## 1. Summary

A Windows desktop application for managing multiple Claude Code CLI sessions across
projects. The left sidebar (~1/4 width) lists projects (folders) as workspace cards; the
main area (~3/4 width) shows the selected project's terminals in an auto-tiling grid. Each terminal is a real
Windows shell that auto-launches `claude`. The app surfaces a live **status** for every
terminal (working / needs-you / idle / error) so the user can instantly see which agent is
blocked waiting for them — solving the "which of my many terminals needs attention?" problem.

## 2. Goals

- Organize Claude CLI terminals by project in one window.
- Show at-a-glance status for every terminal, especially **"needs you"** (blocked on a
  permission prompt or question).
- Open / close / rename terminals; add / remove projects.
- Auto-tiling grid for the selected project's terminals (1 = full, 2 = split, 4 = 2×2, …).
- Remember project list + layout across launches.

## 3. Non-Goals (YAGNI)

- No background daemon / process survival across app close (terminals stop when the app closes).
- No programmatic command broadcasting or task templates (deferred; this is "organizer +
  status", not full orchestration).
- No cross-project grid (grid is scoped to the selected project).
- No session resurrection (layout is restored, processes start fresh).
- No auto-scan of a parent workspace folder (projects are added manually).

## 4. Tech Stack

- **Electron** (main + renderer).
- **xterm.js** for terminal rendering (+ `xterm-addon-fit`, `xterm-addon-webgl`).
- **node-pty** for real PTYs (ConPTY on Windows).
- **Renderer UI:** React + Vite + TypeScript.
- **State:** lightweight store (Zustand) in renderer; persisted JSON in main.
- **Packaging:** electron-builder (NSIS installer for Windows).
- **Testing:** Vitest (unit), Playwright/Electron harness (integration), manual smoke checklist.

Rationale: this is the exact stack VS Code's integrated terminal uses, making the riskiest
part (a correct Windows terminal) a solved problem. Status integration is trivial in Node.

## 5. Architecture

Two Electron processes:

### Renderer (UI)
- **Sidebar (fixed ~1/4 of window width)** — workspace **cards only**, one per project:
  project name (bright) on top, full folder path (muted) below, rounded card with subtle
  border. The selected card gets a teal accent border. Each card shows a single **aggregate
  status dot** (amber if any terminal in that project is `needs-you`, red if any `error`,
  else neutral) so a blocked project is visible even when another is selected. Terminals are
  **not** listed in the sidebar. "+ Add" button at top adds a project (folder picker);
  right-click a card → rename / remove. Sidebar is resizable but defaults to 25%.
- **Grid (remaining ~3/4 of width)** — auto-tiling panes for the **selected** project's
  terminals. One focused pane receives keystrokes (teal border). Each pane: xterm.js
  instance + a header showing the terminal's name, its own status dot, and restart/close.
  A "＋ new terminal" action spawns another terminal in the selected project.
- Communicates with main over typed IPC channels.

### Main (Node)
- **PTY Manager** — one `node-pty` ConPTY per terminal. Spawns the user's shell in the
  project folder, auto-runs `claude`, injects env: `ARW_TERMINAL_ID` (unique) and
  `ARW_EVENT_URL` (shared). Streams output to renderer; forwards keystrokes; detects
  exit via `onExit`.
- **Status Bridge** — single HTTP server bound to `127.0.0.1` on a free port chosen at
  startup. Receives `POST /event {id, state}` from Claude hooks, maps `id` → terminal,
  pushes state to renderer over IPC.
- **Store** — persists projects + terminal layout + last-selected project to a JSON file
  in Electron `userData`. Debounced writes.
- **Hook Installer** — on first run, merges the app's hook entries into
  `~/.claude/settings.json` (atomic temp-write + rename; backs up original once; never
  clobbers existing user hooks). Removed on uninstall.

### Data flow (status)
```
PTY spawned → env {ARW_TERMINAL_ID=term-7, ARW_EVENT_URL=http://127.0.0.1:54123/event}
claude runs → hook fires → POST {id:"term-7", state:"needs-you"} → Status Bridge
            → IPC → renderer → sidebar dot + pane border turn amber
PTY exits non-zero → PTY Manager onExit → state:"error" → red
```

## 6. Status Detection

Status comes from **Claude Code's own hooks**, not terminal-text scraping.

| Claude hook                   | State      | Color            |
|-------------------------------|------------|------------------|
| PreToolUse / UserPromptSubmit | working    | green `#C3E88D`  |
| Notification                  | needs-you  | amber `#FFCB6B`  |
| Stop                          | idle       | grey  `#546E7A`  |
| (PTY onExit, non-zero/unexpected) | error  | red   `#F07178`  |

- Hook command is a small bundled cross-platform script (Node/PowerShell one-liner) so it
  does **not** depend on `curl`. It reads `ARW_TERMINAL_ID` / `ARW_EVENT_URL` from its
  inherited environment and POSTs to the Status Bridge.
- **Fallback heuristic:** if hooks don't fire, the PTY Manager infers working/idle from raw
  output activity (recent output = working, quiet for N seconds = idle) so badges degrade
  gracefully rather than going stale.
- Server is loopback-only; nothing is exposed to the network.

## 7. Auto-Tiling Grid

- Scope: the **selected project's** terminals. Switching projects swaps the grid.
- Tiling math: for `n` panes, `cols = ceil(sqrt(n))`, `rows = ceil(n / cols)` (1→1×1,
  2→2×1, 3–4→2×2, 5–6→3×2, 7–9→3×3, …). Last row may be partially filled.
- One focused pane (accent border) receives keyboard input; click a pane to focus.
- Each pane keeps its own xterm buffer; resizing refits via `xterm-addon-fit` and notifies
  the PTY of new cols/rows.
- The sidebar card's **aggregate status dot** reflects the worst state among a project's
  terminals (error > needs-you > working > idle), so a "needs you" or crash in another
  project is never hidden even though that project's terminals aren't in the current grid.

## 8. UI / Visual Design

- **Theme:** Material Theme **Oceanic** (dark).
  - Surfaces: `#0F111A` (deepest / terminal bg) · `#1A1C25` (panels/sidebar) · `#1F2233` (raised).
  - Text: `#A6ACCD` primary · `#717CB4` muted.
  - Accent: teal `#80CBC4` (focus borders, selection, primary actions).
  - Status: green `#C3E88D` · amber `#FFCB6B` · grey `#546E7A` · red `#F07178`.
  - Selection tint: `#717CB420`.
- **Layout proportions:** sidebar ~1/4 of window width, terminal grid ~3/4 (sidebar
  resizable, 25% default).
- **Sidebar cards:** name (bright) + path (muted), rounded corners, subtle border; selected
  card has a teal accent border; one aggregate status dot per card (top-right).
- **Status presentation:** per-terminal status shown as a colored dot in each grid pane's
  header; the focused pane has a teal border. Sidebar cards carry only the aggregate dot.
- Terminal area renders its own (matching Oceanic) xterm theme.
- Window: custom title bar consistent with the dark chrome.

## 9. Data Model (persisted JSON)

```jsonc
{
  "version": 1,
  "lastSelectedProjectId": "p1",
  "projects": [
    {
      "id": "p1",
      "name": "piros-api",
      "path": "D:\\PIROS\\piros-api",
      "collapsed": false,
      "terminals": [
        { "id": "t1", "name": "fix-auth-bug", "order": 0 },
        { "id": "t2", "name": "write-tests",  "order": 1 }
      ]
    }
  ]
}
```
- Runtime-only (not persisted): live status, PTY handle, xterm buffer, focused pane.
- IDs are stable across launches; PTYs are re-created fresh on load.

## 10. Error Handling

- **PTY spawn fails** (bad path / shell missing): pane shows inline error + Retry; rest of
  app unaffected.
- **Project folder missing/moved:** project row shows "missing" marker; relink or remove.
- **Status Bridge port in use:** pick another free port at startup; inject the chosen port.
- **settings.json hook write:** atomic temp-write + rename; one-time backup of original;
  merge preserves existing user hooks.
- **One terminal crash never affects others:** each PTY is isolated; renderer guards against
  events for unknown terminal IDs.

## 11. Testing Strategy

- **Unit (Vitest):**
  - Grid tiling math: `n` → `(rows, cols)` for n = 1..16.
  - Status state machine: hook/exit event → resulting state/color.
  - settings.json hook-merge: preserves existing hooks, idempotent, backup created.
  - Store serialization round-trip.
- **Integration (Electron + headless):**
  - Spawn a real PTY running a dummy script that emits hook-style POSTs; assert badge
    transitions working → needs-you → idle, and exit → error.
  - Add project → open 4 terminals → assert 2×2 grid; close one → assert reflow to 3.
- **Manual smoke checklist:** add project; open terminals; confirm grid scaling; trigger a
  real `claude` permission prompt; confirm amber "needs you"; restart/close; relaunch and
  confirm layout restored.

## 12. Build Order (high level)

1. Electron + Vite + React skeleton; Oceanic theme shell (sidebar + empty grid).
2. PTY Manager + single xterm pane wired end-to-end (type in shell, see output).
3. Projects/terminals data model + persistence + Add Project / new terminal / rename / close.
4. Auto-tiling grid + focus handling + resize/refit.
5. Status Bridge + Hook Installer + status badges/borders + fallback heuristic.
6. Error states, polish, packaging (electron-builder NSIS), tests.

## 13. Resolved Decisions

- Scope: organizer + status awareness (not full orchestration).
- Persistence: remember layout, restart fresh (no daemon).
- Terminal: auto-launch `claude` in a full shell (user can Ctrl-C to other commands).
- Projects: added manually via sidebar button.
- Grid: scoped to selected project, auto-tiling by count.
- Stack: Electron + xterm.js + node-pty.
- Status: Claude Code hooks → single localhost server, terminals distinguished by ID.
- Theme: Material Oceanic dark; status = dot + accent border.
