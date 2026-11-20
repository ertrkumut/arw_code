import { app, ipcMain, utilityProcess, type UtilityProcess, type WebContents } from 'electron'
import { join } from 'path'
import { IPC } from '@shared/constants'

/**
 * Owns the voice model process (voiceHost.ts). One at a time: started when a window turns
 * voice mode on, killed when it turns it off, the window goes away, or the app quits.
 * Everything the host says goes to the window that started it as an `IPC.voiceEvent`.
 */
export function registerVoice() {
  let proc: UtilityProcess | null = null
  let owner: WebContents | null = null

  const send = (m: unknown) => { if (owner && !owner.isDestroyed()) owner.send(IPC.voiceEvent, m) }

  const stop = () => {
    const p = proc
    proc = null
    owner = null
    try { p?.kill() } catch { /* already gone */ }
  }

  ipcMain.handle(IPC.voiceStart, (e, p: { voice: string }) => {
    stop()
    owner = e.sender
    owner.once('destroyed', () => { if (owner === e.sender) stop() })
    const child = utilityProcess.fork(join(__dirname, 'voiceHost.js'), [], { serviceName: 'ARWCode Voice', stdio: 'pipe' })
    proc = child
    child.stdout?.on('data', (d) => console.log('[voice]', String(d).trim()))
    child.stderr?.on('data', (d) => console.warn('[voice]', String(d).trim()))
    child.on('message', (m) => { if (proc === child) send(m) })
    child.on('exit', (code) => {
      if (proc !== child) return
      proc = null
      send({ type: 'error', message: `The voice process stopped (code ${code}).` })
    })
    child.postMessage({ type: 'init', cacheDir: join(app.getPath('userData'), 'voice-models'), voice: p?.voice })
  })

  // Audio and text go straight through; the host answers with voiceEvent messages.
  ipcMain.on(IPC.voiceSend, (e, m: unknown) => { if (proc && e.sender === owner) proc.postMessage(m) })
  ipcMain.on(IPC.voiceStop, (e) => { if (e.sender === owner) stop() })
  app.on('before-quit', stop)
}
