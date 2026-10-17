// PLAN-10 E-2: the page's VS Code host adapter (src/graphView/vscodeHost.js) and the page html.js
// makes for the VS Code panel (`host: 'vscode'`, `nonce`). The adapter's DOM side runs in the real
// browser (browser-tests/graph-vscode.mjs) and in VS Code (editors/vscode smoke test).
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { linkTarget, themeOf, VSCODE_CSS } from '../src/graphView/vscodeHost.js'
import { graphHtml, inlineModule } from '../src/graphView/html.js'

const pageCss = fs.readFileSync(fileURLToPath(new URL('../src/graphView/page.css', import.meta.url)), 'utf8')
const G = { version: 1, source: 'static', components: [{ name: 'App', id: 'src/App.jsx:3', key: 'src/App.jsx#App', parentId: null, file: 'src/App.jsx', kind: 'root', actions: [], stateKeys: [], calculated: [], contextProvides: [], contextConsumes: [], eventsEmitted: [], eventsSelected: [], children: [], selectors: [], diagnostics: [] }], events: {}, diagnostics: [] }
const NONCE = 'abcdefghijklmnopqrstuvwx'
/** The href page.js editorHref() makes for the editor 'vscode'. */
const href = (root, file, line) => { const abs = root + '/' + file; return `vscode://file${abs.startsWith('/') ? '' : '/'}${encodeURI(abs)}:${line}` }

describe('linkTarget', () => {
  it("reads the page's own editor links back, relative to the root", () => {
    expect(linkTarget(href('/w/app', 'src/Cart.jsx', 12), '/w/app')).toEqual({ file: 'src/Cart.jsx', line: 12 })
    expect(linkTarget(href('/w/my app', 'src/a b/Ü.jsx', 3), '/w/my app')).toEqual({ file: 'src/a b/Ü.jsx', line: 3 })
    expect(linkTarget(href('/w/app', 'src/x.jsx', 4), '/w/app/')).toEqual({ file: 'src/x.jsx', line: 4 })
  })
  it('Windows roots', () => {
    expect(linkTarget(href('C:/w/app', 'src/Cart.jsx', 7), 'C:/w/app')).toEqual({ file: 'src/Cart.jsx', line: 7 })
    expect(linkTarget(href('C:/w/app', 'src/Cart.jsx', 7), 'C:\\w\\app')).toEqual({ file: 'src/Cart.jsx', line: 7 })
  })
  it('nothing outside the root, and no other links', () => {
    expect(linkTarget(href('/w/other', 'src/x.jsx', 1), '/w/app')).toBeNull()
    expect(linkTarget(href('/w/app-2', 'src/x.jsx', 1), '/w/app')).toBeNull() // a sibling with the root as a prefix
    expect(linkTarget('vscode://file/w/app/../etc/passwd:1', '/w/app')).toBeNull()
    expect(linkTarget('vscode://file/w/app/src/x.jsx', '/w/app')).toBeNull() // no line
    expect(linkTarget('https://sygnal.js.org/reference/errors#syg101', '/w/app')).toBeNull()
    expect(linkTarget('cursor://file/w/app/src/x.jsx:1', '/w/app')).toBeNull()
    expect(linkTarget('vscode://file/w/app/%E0%A4%A:1', '/w/app')).toBeNull() // bad escape
    expect(linkTarget(href('/w/app', 'src/x.jsx', 1), '')).toBeNull()
    expect(linkTarget(null, '/w/app')).toBeNull()
  })
})

describe('theme', () => {
  it("follows VS Code's theme kind", () => {
    expect(themeOf(['vscode-light'])).toBe('light')
    expect(themeOf(['vscode-high-contrast-light', 'vscode-high-contrast'])).toBe('light')
    expect(themeOf(['vscode-dark'])).toBe('dark')
    expect(themeOf(['vscode-high-contrast'])).toBe('dark')
    expect(themeOf([])).toBe('dark')
  })
  it("maps only tokens the page defines, each to VS Code's variables", () => {
    const pageTokens = new Set([...pageCss.matchAll(/(--[\w-]+):/g)].map(m => m[1]))
    const mapped = [...VSCODE_CSS.matchAll(/^\s*(--[\w-]+):\s*(.+);$/gm)]
    expect(mapped.length).toBeGreaterThan(10)
    for (const [, token, value] of mapped) {
      expect(pageTokens.has(token), token).toBe(true)
      expect(value, token).toMatch(/^var\(--vscode-/)
    }
    // the surface and text tokens are VS Code's
    for (const t of ['--bg', '--panel', '--card', '--ink', '--muted', '--line', '--accent', '--err', '--warn']) expect(mapped.some(m => m[1] === t), t).toBe(true)
  })
})

describe('the panel page', () => {
  it('inlines the adapter and runs its script by the nonce', () => {
    const html = graphHtml(G, { title: 'shop', root: '/w/app', rootUri: 'file:///w/app', version: 1, host: 'vscode', nonce: NONCE })
    const csp = /http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(html)[1]
    expect(csp).toContain(`script-src 'nonce-${NONCE}'`)
    expect(csp).not.toMatch(/script-src[^;]*unsafe-inline/)
    expect(csp).toContain("default-src 'none'")
    expect(csp).not.toContain('connect-src')
    const scripts = [...html.matchAll(/<script([^>]*)>/g)].map(m => m[1])
    expect(scripts.filter(a => !/type="application\/json"/.test(a))).toEqual([` nonce="${NONCE}"`])
    expect(html).toContain('V.mountVscode(V, api')
    expect(html).toContain('// ── vscodeHost.js ──')
    // the nonce is not in the page's data; the meta is
    const meta = JSON.parse(/<script type="application\/json" id="graph-meta">(.*?)<\/script>/s.exec(html)[1])
    expect(meta).toMatchObject({ host: 'vscode', rootUri: 'file:///w/app', version: 1, root: '/w/app' })
    expect(meta.nonce).toBeUndefined()
    // a graph that updates may add codes: every title
    expect(Object.keys(meta.codes).length).toBeGreaterThan(50)
    expect(html.split(NONCE).length).toBe(3) // the CSP and the script, nowhere else
  })
  it('the CLI page has neither', () => {
    const html = graphHtml(G, { title: 'shop' })
    expect(html).not.toContain('vscodeHost.js')
    expect(html).not.toContain('nonce')
    expect(html).toContain("script-src 'unsafe-inline'")
  })
  it('refuses a nonce that could break out of the attribute', () => {
    expect(() => graphHtml(G, { host: 'vscode', nonce: 'short' })).toThrow(/nonce/)
    expect(() => graphHtml(G, { host: 'vscode', nonce: 'abcdefghijklmnopqrstuv" onload="x' })).toThrow(/nonce/)
  })
  it('the adapter fits the inlining rules', () => {
    const src = fs.readFileSync(fileURLToPath(new URL('../src/graphView/vscodeHost.js', import.meta.url)), 'utf8')
    expect(() => inlineModule(src, 'vscodeHost.js')).not.toThrow()
  })
})
