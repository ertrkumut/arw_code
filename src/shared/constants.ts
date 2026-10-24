export const ENV_TERMINAL_ID = 'ARW_TERMINAL_ID'
export const ENV_EVENT_URL = 'ARW_EVENT_URL'

export const IPC = {
  ptySpawn: 'pty:spawn',
  ptyInput: 'pty:input',
  ptyResize: 'pty:resize',
  ptyKill: 'pty:kill',
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
  openPath: 'shell:openPath',
  historyList: 'history:list',             // renderer -> main (invoke): Claude sessions saved for a folder
  historyDelete: 'history:delete'          // renderer -> main (invoke): delete one saved Claude session
} as const

export const DEFAULT_SIDEBAR_PCT = 25
