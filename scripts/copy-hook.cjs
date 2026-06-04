#!/usr/bin/env node
const fs = require('fs')
const path = require('path')

const src = path.join(__dirname, '..', 'src', 'main', 'hook-script')
const dest = path.join(__dirname, '..', 'out', 'main', 'hook-script')

fs.cpSync(src, dest, { recursive: true })
console.log('Copied hook-script to out/main/hook-script')
