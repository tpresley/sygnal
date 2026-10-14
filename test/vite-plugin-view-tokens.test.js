// The Vite plugin's SYG103 view words (plugin.ts, 11): a module that sets X.intent / X.uses gets,
// on the dev server, a tail registering the words of its string literals and of the relative
// modules it imports in globalThis.__SYGNAL_VIEW_TOKENS__ (read by checks/dom.ts). Runs against
// the built plugin (npm run build).
import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import ts from 'typescript'
import sygnal from '../dist/vite/plugin.mjs'

let tmp
afterEach(() => { if (tmp) fs.rmSync(tmp, { recursive: true, force: true }); tmp = null; delete globalThis.__SYGNAL_VIEW_TOKENS__ })

function plugin(options, { command = 'serve', vitest = false } = {}) {
  const p = sygnal(options)
  const saved = process.env.VITEST
  if (vitest) process.env.VITEST = 'true'
  else delete process.env.VITEST
  try { p.config({}, { command }); p.configResolved?.({ root: process.cwd() }) } finally {
    if (saved === undefined) delete process.env.VITEST
    else process.env.VITEST = saved
  }
  return p
}

const watched = []
const ctx = {
  resolve: async (spec, importer) => ({ id: path.resolve(path.dirname(importer), spec) }),
  addWatchFile: (f) => watched.push(f),
}

const PAGE = `import { h } from 'sygnal'
import { panel } from './panel.js'
import './page.css'
export function Page({ state }) { return h('div', { className: 'page' }, state.open ? panel() : null) }
Page.initialState = { open: false }
Page.intent = ({ DOM }) => ({ SAVE: DOM.click('.save'), TYPO: DOM.select('form .svae').events('click'), PATH: DOM.click('/Users/x') })
Page.model = { SAVE: (state) => ({ ...state, open: false }) }
function Helper() {}
// a comment 'commented-word'
`

function files() {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sygnal-view-tokens-'))
  fs.writeFileSync(path.join(tmp, 'panel.js'), `export const panel = () => <button type="button" className="save">Save</button>\n`)
  fs.writeFileSync(path.join(tmp, 'page.css'), `.from-css { color: red }\n`)
  return path.join(tmp, 'page.jsx')
}

const tailOf = (result, code) => (typeof result == 'string' ? result : result.code).slice(code.length)

describe('vite plugin: SYG103 view words', () => {
  it("registers the module's and its relative JS imports' words for each component with an intent", async () => {
    const id = files()
    const result = await plugin().transform.call(ctx, PAGE, id)
    const tail = tailOf(result, PAGE)
    expect(tail).toContain("typeof Page == 'function' && Page")
    expect(tail).not.toContain('Helper')
    const sf = ts.createSourceFile('m.js', result.code, ts.ScriptTarget.Latest, false, ts.ScriptKind.JS)
    expect(sf.parseDiagnostics).toEqual([])
    // run the tail: Page gets the words
    function Page() {}
    new Function('Page', tail)(Page)
    const words = globalThis.__SYGNAL_VIEW_TOKENS__.get(Page).split(' ')
    expect(words).toEqual(expect.arrayContaining(['save', 'button', 'page', 'div']))
    expect(words).not.toContain('from-css')        // a stylesheet isn't markup
    expect(words).not.toContain('commented-word')  // comments are skipped
    expect(words).not.toContain('svae')            // the intent's selector strings don't vouch for themselves
    expect(words).not.toContain('Users')           // nor paths
    expect(watched).toContain(path.join(tmp, 'panel.js'))
  })

  it('nothing for a module without components with selectors, or in a build, under Vitest or with diagnostics off', async () => {
    const id = files()
    const plain = `export const x = 'save'\n`
    expect(await plugin().transform.call(ctx, plain, id)).toBe(null)
    expect(await plugin({}, { command: 'build' }).transform.call(ctx, PAGE, id)).toBe(null)
    expect(await plugin({}, { vitest: true }).transform.call(ctx, PAGE, id)).toBe(null)
    expect(await plugin({ diagnostics: 'off' }).transform.call(ctx, PAGE, id)).toBe(null)
  })

  it('an entry that calls run() keeps its dev snippet and HMR wiring, with the words after', async () => {
    const id = files()
    const entry = `import { run } from 'sygnal'\nimport App from './App.jsx'\n${PAGE.split('\n').slice(3).join('\n')}\nrun(App)\n`
    const result = await plugin().transform.call(ctx, entry, id)
    expect(result.code).toContain("import 'sygnal/diagnostics'")
    expect(result.code).toContain('import.meta.hot')
    expect(result.code).toContain('__SYGNAL_VIEW_TOKENS__')
    expect(result.map).toBeTruthy()
  })
})
