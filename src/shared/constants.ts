export const ENV_TERMINAL_ID = 'ARW_TERMINAL_ID'
export const ENV_EVENT_URL = 'ARW_EVENT_URL'

export const IPC = {
  ptySpawn: 'pty:spawn',
  ptyInput: 'pty:input',
  ptyResize: 'pty:resize',
  ptyKill: 'pty:kill',
  chatOpen: 'chat:open',      // renderer -> main (invoke): register a Claude chat pane, returns { sessionId, transcript }
  chatSend: 'chat:send',      // renderer -> main: send a prompt
  chatInterrupt: 'chat:interrupt', // renderer -> main: stop the current turn
  chatReset: 'chat:reset',    // renderer -> main (invoke): new conversation (/clear)
  chatSuspend: 'chat:suspend', // renderer -> main (invoke): pause the headless process before terminal mode
  chatReturn: 'chat:return',   // renderer -> main (invoke): back to chat; returns the fresh transcript
  chatEvent: 'chat:event',    // main -> renderer: { id, event } one Claude stream-json event
  ptyData: 'pty:data',        // main -> renderer
  ptyExit: 'pty:exit',        // main -> renderer
  ptyError: 'pty:error',      // main -> renderer
  statusUpdate: 'status:update', // main -> renderer
  terminalTearOff: 'terminal:tearOff',     // renderer -> main: pop a terminal into its own window
  terminalReattach: 'terminal:reattach',   // renderer (child) -> main: request return to grid
  terminalReattached: 'terminal:reattached', // main -> renderer (main win): clear detached flag
  terminalClosed: 'terminal:closed',       // main -> renderer (main win): torn-off window closed, drop terminal
  storeLoad: 'store:load',
  storeSave: 'store:save',
  pickFolder: 'dialog:pickFolder',
  fsExists: 'fs:exists',
  clipboardRead: 'clipboard:read',
  clipboardWrite: 'clipboard:write',
  clipboardReadImage: 'clipboard:readImage', // renderer -> main (invoke): clipboard image as a PNG data URL, or null
  clipboardWriteImage: 'clipboard:writeImage', // renderer -> main (invoke): put an image data URL on the clipboard
  openPath: 'shell:openPath',
  openExternal: 'shell:openExternal',       // renderer -> main: open an http(s) link in the browser
  historyList: 'history:list',             // renderer -> main (invoke): Claude sessions saved for a folder
  historyDelete: 'history:delete',         // renderer -> main (invoke): delete one saved Claude session
  historyImages: 'history:images',         // renderer -> main (invoke): images sent in a terminal's Claude session
  fsReadDir: 'fs:readDir',                 // renderer -> main (invoke): one level of a folder for the file explorer
  fsWatch: 'fs:watch',                     // renderer -> main: start watching a project root
  fsUnwatch: 'fs:unwatch',                 // renderer -> main: stop watching a project root
  fsChanged: 'fs:changed',                 // main -> renderer: { root, dirs } whose listings changed
  revealPath: 'shell:revealPath',          // renderer -> main: select a file in the OS file manager
  fsListFiles: 'fs:listFiles',             // renderer -> main (invoke): all files under a root (Go to File)
  fsReadFile: 'fs:readFile',               // renderer -> main (invoke): text file for the editor
  fsWriteFile: 'fs:writeFile',             // renderer -> main (invoke): save an editor buffer
  ideLoad: 'ide:load',                     // renderer -> main (invoke): editor/IDE state (theme, breakpoints, tabs)
  idePatch: 'ide:patch',                   // renderer -> main: merge a change into the IDE state
  ideChanged: 'ide:changed',               // main -> other windows: that change, to apply locally
  ideOpen: 'ide:open',                     // renderer -> main: open/focus a project's IDE window (optionally a file)
  setTitleBarColors: 'win:titleBarColors', // renderer -> main: recolor the native window-controls overlay
  debugStart: 'debug:start',               // renderer -> main (invoke): spawn the Unity debug adapter + initialize
  debugRequest: 'debug:request',           // renderer -> main (invoke): any DAP request -> response body
  debugStop: 'debug:stop',                 // renderer -> main: disconnect + kill the adapter
  debugEvent: 'debug:event',               // main -> renderer: DAP event { event, body }
  debugExit: 'debug:exit'                  // main -> renderer: adapter process ended { code, stderr }
} as const

export const DEFAULT_SIDEBAR_PCT = 25
export const DEFAULT_EXPLORER_WIDTH = 280
