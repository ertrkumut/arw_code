// Rebuilds the native PTY module for Electron's ABI.
//
// Two Windows-specific problems are handled here so a fresh `npm install` works:
//
// 1. The bundled winpty build runs `cmd /c "cd shared && GetCommitHash.bat"`. When the
//    environment sets NoDefaultCurrentDirectoryInExePath=1 (common on hardened/managed
//    Windows), cmd refuses to run a script from the current directory, so that step fails
//    with "GetCommitHash.bat is not recognized". We clear the var for the child build.
//
// 2. The package's gyp files request `SpectreMitigation: 'Spectre'`, which requires the
//    "MSVC Spectre-mitigated libraries" VS component. A default VS Community install does
//    not include it (MSB8040). We strip that setting before building; a local dev terminal
//    tool does not need Spectre-mitigated CRT.
//
// On non-Windows platforms this is effectively a plain electron-rebuild.

const { execSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const PKG = 'node-pty-prebuilt-multiarch'
const root = path.join(__dirname, '..')
const pkgDir = path.join(root, 'node_modules', '@homebridge', PKG)

// 1. Strip SpectreMitigation from the package's gyp files (idempotent).
const gypFiles = [
  path.join(pkgDir, 'binding.gyp'),
  path.join(pkgDir, 'deps', 'winpty', 'src', 'winpty.gyp'),
  path.join(pkgDir, 'deps', 'winpty', 'src', 'configurations.gypi')
]
for (const f of gypFiles) {
  if (!fs.existsSync(f)) continue
  const lines = fs.readFileSync(f, 'utf8').split(/\r?\n/)
  const kept = lines.filter((l) => !/SpectreMitigation/.test(l))
  if (kept.length !== lines.length) {
    fs.writeFileSync(f, kept.join('\n'))
    console.log(`[rebuild-native] stripped SpectreMitigation from ${path.relative(root, f)}`)
  }
}

// 2. Clear the env var that breaks winpty's GetCommitHash.bat step (child build inherits this).
delete process.env.NoDefaultCurrentDirectoryInExePath

// 3. Rebuild for Electron's ABI.
execSync(`npx electron-rebuild -f -w @homebridge/${PKG}`, { stdio: 'inherit', cwd: root })
