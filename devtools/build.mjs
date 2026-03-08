#!/usr/bin/env node

/**
 * Copies the devtools/ extension source to dist-devtools/
 * for loading as an unpacked Chrome extension.
 *
 * Usage: node devtools/build.mjs
 */

import { cpSync, rmSync, mkdirSync, existsSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')
const src = resolve(root, 'devtools')
const dest = resolve(root, 'dist-devtools')

// Clean and recreate output directory
if (existsSync(dest)) {
  rmSync(dest, { recursive: true })
}
mkdirSync(dest, { recursive: true })

// Copy all extension files
const files = [
  'manifest.json',
  'devtools.html',
  'devtools.js',
  'panel.html',
  'panel.js',
  'panel.css',
  'content-script.js',
  'background.js',
]

for (const file of files) {
  cpSync(resolve(src, file), resolve(dest, file))
}

// Copy icons
mkdirSync(resolve(dest, 'icons'), { recursive: true })
const icons = ['icon16.png', 'icon32.png', 'icon48.png', 'icon128.png']
for (const icon of icons) {
  cpSync(resolve(src, 'icons', icon), resolve(dest, 'icons', icon))
}

console.log(`Sygnal DevTools extension built to ${dest}`)
console.log('Load as unpacked extension in chrome://extensions/')
