// PLAN-10 P-1: the devtools App graph frame's files (devtools/graph-files.mjs, written by
// devtools/build.mjs from sygnal-check's graph page). The panel side: p10-devtools-graph.test.js.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { graphFrameFiles, GRAPH_FRAME_CSP } from '../devtools/graph-files.mjs'

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'devtools')

describe('P-1: the App graph frame files', () => {
  it('graph.html runs no inline script, loads only its own files, and carries a CSP without unsafe-inline scripts', async () => {
    const files = await graphFrameFiles()
    expect(Object.keys(files).sort()).toEqual(['graph-page.css', 'graph-page.js', 'graph.html'])
    const html = files['graph.html']
    const scripts = [...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)]
    expect(scripts.map(m => m[1].trim())).toEqual(['src="graph-page.js"', 'src="graph-frame.js"'])
    expect(scripts.every(m => m[2] === '')).toBe(true)
    expect(html).not.toMatch(/<style/)
    expect(html).toContain('<link rel="stylesheet" href="graph-page.css">')
    expect(html).toContain(`content="${GRAPH_FRAME_CSP}"`)
    expect(GRAPH_FRAME_CSP).toMatch(/script-src 'self';/)
    expect(GRAPH_FRAME_CSP).not.toMatch(/script-src[^;]*unsafe/)
    expect(html).not.toMatch(/https?:\/\//)
    expect(files['graph-page.js']).not.toMatch(/\bimport\s*\(|\bfetch\(|XMLHttpRequest|WebSocket|EventSource/)
    // the markup the page needs is there (the same graphHtml() as `sygnal-check --graph=html`)
    for (const id of ['svg', 'detail', 'health', 'tree', 'q']) expect(html).toContain(`id="${id}"`)
  })

  it('graph-page.js defines the page modules (no fork: the same files the CLI inlines)', async () => {
    const { 'graph-page.js': js } = await graphFrameFiles()
    const win = {}
    new Function('window', js)(win)
    for (const k of ['mountPage', 'buildModel', 'layoutGraph', 'fromRuntime', 'runtimeHealth']) expect(typeof win.__sygnalGraphV[k]).toBe('function')
  })

  it('the manifest relaxes no CSP and build.mjs copies the frame bridge', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(DIR, 'manifest.json'), 'utf8'))
    expect(manifest.content_security_policy).toBeUndefined()
    expect(fs.readFileSync(path.join(DIR, 'build.mjs'), 'utf8')).toContain("'graph-frame.js'")
  })
})

