# Agent Manager — Manual Smoke Test
1. Launch app → dark Oceanic window, empty sidebar (PROJECTS + Add).
2. Click "+ Add", pick a project folder → card shows name + path.
3. Select the card → grid area shows "No terminals yet".
4. Click "＋ new terminal" → a pane opens, PowerShell loads, `claude` auto-runs.
5. Open 3 more terminals → panes auto-arrange to 2x2.
6. Click a pane → its border turns teal; typing goes to that pane.
7. Ask Claude to do something that needs permission → pane dot + card dot turn amber (needs-you).
8. Let Claude work → green; when it stops → grey (idle).
9. Close one pane (✕) → grid reflows to 3 and remaining panes resize.
10. Add a second project, open a terminal, trigger a prompt there → switch back to project 1; project 2's card dot is amber.
11. Quit and relaunch → projects + layout restored, fresh shells.
12. Check ~/.claude/settings.json → arw hook entries present (command contains arw-hook.cjs); .arw-backup exists; pre-existing hooks intact.
13. Delete/rename a project's folder on disk, relaunch → that card shows red "missing".
