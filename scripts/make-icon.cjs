// Renders build/icon.svg to build/icon.png (256px) and build/icon.ico (256..16, PNG entries).
// Run with Electron so Chromium does the SVG rasterizing:  npx electron scripts/make-icon.cjs
const { app, BrowserWindow } = require('electron')
const { readFileSync, writeFileSync } = require('fs')
const { join } = require('path')

const root = join(__dirname, '..')
const svg = readFileSync(join(root, 'build', 'icon.svg'), 'utf8')
const SIZES = [256, 128, 64, 48, 32, 24, 16]

function ico(pngs) {
  const header = Buffer.alloc(6 + 16 * pngs.length)
  header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(pngs.length, 4)
  let offset = header.length
  pngs.forEach(({ size, data }, i) => {
    const e = 6 + 16 * i
    header.writeUInt8(size >= 256 ? 0 : size, e)
    header.writeUInt8(size >= 256 ? 0 : size, e + 1)
    header.writeUInt16LE(1, e + 4)        // planes
    header.writeUInt16LE(32, e + 6)       // bpp
    header.writeUInt32LE(data.length, e + 8)
    header.writeUInt32LE(offset, e + 12)
    offset += data.length
  })
  return Buffer.concat([header, ...pngs.map(p => p.data)])
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 256, height: 256, frame: false, transparent: true, webPreferences: { offscreen: true } })
  const pngs = []
  for (const size of SIZES) {
    win.setContentSize(size, size)
    const html = `<html><body style="margin:0;background:transparent;overflow:hidden">${svg.replace('width="256" height="256"', `width="${size}" height="${size}"`)}</body></html>`
    await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
    await new Promise(r => setTimeout(r, 150))
    const img = (await win.webContents.capturePage({ x: 0, y: 0, width: size, height: size })).resize({ width: size, height: size, quality: 'best' })
    pngs.push({ size, data: img.toPNG() })
  }
  writeFileSync(join(root, 'build', 'icon.png'), pngs[0].data)
  writeFileSync(join(root, 'build', 'icon.ico'), ico(pngs))
  console.log('wrote build/icon.png and build/icon.ico:', SIZES.join(', '))
  app.quit()
})
