export const ENV_TERMINAL_ID = 'ARW_TERMINAL_ID'
export const ENV_EVENT_URL = 'ARW_EVENT_URL'

export const IPC = {
  ptySpawn: 'pty:spawn',
  ptyInput: 'pty:input',
  ptyResize: 'pty:resize',
  ptyKill: 'pty:kill',
  ptyData: 'pty:data',        // main -> renderer
  ptyExit: 'pty:exit',        // main -> renderer
  statusUpdate: 'status:update', // main -> renderer
  storeLoad: 'store:load',
  storeSave: 'store:save',
  pickFolder: 'dialog:pickFolder'
} as const

export const DEFAULT_SIDEBAR_PCT = 25
export const IDLE_FALLBACK_MS = 2500
