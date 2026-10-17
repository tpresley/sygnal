#!/usr/bin/env node

/**
 * Copies the devtools/ extension source to dist-devtools/
 * for loading as an unpacked Chrome extension.
 *
 * PLAN-10 P-1: the App graph view (graph.html, in an iframe of the panel) is the graph page of
 * sygnal-check/src/graphView/ (the same modules `sygnal-check --graph=html` inlines, no fork),
 * written as files because an extension page can't run inline script (MV3 CSP):
 *   graph.html       the page's markup from graphHtml(), with its stylesheet and script as files
 *   graph-page.css   page.css
 *   graph-page.js    the inlined modules on window.__sygnalGraphV
 *   graph-frame.js   the bridge the panel calls (devtools/graph-frame.js)
 *
 * Usage: node devtools/build.mjs [outDir]
 */

import { cpSync, rmSync, mkdirSync, existsSync, writeFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath, pathToFileURL } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')
const src = resolve(root, 'devtools')
const dest = resolve(root, process.argv[2] || 'dist-devtools')

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
  'graph-frame.js',
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

// PLAN-10 P-1: the graph page as files
const { graphFrameFiles } = await import(pathToFileURL(resolve(src, 'graph-files.mjs')).href)
for (const [name, text] of Object.entries(await graphFrameFiles())) writeFileSync(resolve(dest, name), text)

console.log(`Sygnal DevTools extension built to ${dest}`)
console.log('Load as unpacked extension in chrome://extensions/')
