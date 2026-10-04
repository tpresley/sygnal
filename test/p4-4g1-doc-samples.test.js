// @vitest-environment jsdom
// PLAN-4 4-G1 (D143): the samples added for undo({ coalesce }) (advanced/undo), run verbatim as test/p4-3b-doc-samples.test.js
// does: each SAMPLES entry is the exact code block of its page (checked by "in the docs"),
// compiled with the automatic JSX runtime, imported against the built package (dist: `npm run
// build` first) and exercised; every sample is checked with `sygnal-check --strict`.
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import ts from 'typescript'
import 'sygnal/diagnostics'
import { renderComponent } from 'sygnal'
import { checkFiles } from '../sygnal-check/src/index.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const docs = path.join(here, '..', 'docs/src/content/docs')

export const SAMPLES = {
  poster: { page: 'advanced/undo.md', code: `import { undo } from 'sygnal'

export function Poster({ state }) {
  return (
    <div>
      <label>Headline <input className="headline" value={state.poster.headline} /></label>
      <button className="larger">Larger</button>
      <button className="undo" disabled={!state.history.canUndo}>Undo</button>
      <button className="redo" disabled={!state.history.canRedo}>Redo</button>
      <h1 style={{ fontSize: \`\${state.poster.size}px\` }}>{state.poster.headline}</h1>
    </div>
  )
}

Poster.initialState = { poster: { headline: '', size: 24 } }
Poster.uses = { history: undo({ key: 'poster', coalesce: ['HEADLINE'], coalesceMs: 1000, undo: '.undo', redo: '.redo' }) }
Poster.intent = ({ DOM }) => ({
  HEADLINE: DOM.input('.headline').value(),
  LARGER: DOM.click('.larger'),
})
Poster.model = {
  HEADLINE: (state, headline) => ({ ...state, poster: { ...state.poster, headline } }),
  LARGER: (state) => ({ ...state, poster: { ...state.poster, size: state.poster.size + 4 } }),
}
` },

}

// whole modules (any finding fails); the rest are fragments
const WHOLE = new Set(['poster'])

let dir
let n = 0
const compile = (src, file) => ts.transpileModule(src, { fileName: file, compilerOptions: {
  jsx: ts.JsxEmit.ReactJSX, jsxImportSource: 'sygnal', module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, allowJs: true,
} }).outputText.replace(/(from\s+['"]\.{1,2}\/[^'"]+?)\.jsx?(['"])/g, '$1.mjs$2')

// Write `files` into a fresh folder, .js/.jsx compiled to .mjs next to them (`shims` repoints
// bare imports of the compiled output); import `main` from it
async function load(files, main, shims = {}) {
  const base = path.join(dir, 'm' + (n++))
  for (const [rel, src] of Object.entries(files)) {
    const file = path.join(base, rel)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, src)
    if (!/\.jsx?$/.test(rel)) continue
    let out = compile(src, rel)
    for (const [from, to] of Object.entries(shims)) out = out.replaceAll(`from '${from}'`, `from '${to}'`).replaceAll(`from "${from}"`, `from "${to}"`)
    fs.writeFileSync(file.replace(/\.jsx?$/, '.mjs'), out)
  }
  return { base, mod: await import(pathToFileURL(path.join(base, main.replace(/\.jsx?$/, '.mjs'))).href) }
}

function check(name, code) {
  const file = path.join(dir, 'check', name + '.jsx')
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, code)
  return checkFiles([file], { cwd: path.dirname(file), strict: true }).map(d => `${d.code} ${d.message}`)
}

beforeAll(() => { dir = fs.mkdtempSync(path.join(here, '.p4-4g1-samples-')) })
afterAll(() => { if (dir) fs.rmSync(dir, { recursive: true, force: true }) })

let t
afterEach(() => {
  try { t?.dispose() } catch (_) {}
  t = null
  vi.restoreAllMocks()
  try { localStorage.clear() } catch (_) {}
  document.body.innerHTML = ''
})

describe('every sample is in its docs page, verbatim', () => {
  for (const [name, { page, code }] of Object.entries(SAMPLES)) {
    it(`${name} (${page})`, () => {
      expect(fs.readFileSync(path.join(docs, page), 'utf8')).toContain('```jsx\n' + code + '```')
    })
  }
})

describe('sygnal-check --strict', () => {
  for (const [name, { code }] of Object.entries(SAMPLES)) {
    it(name, () => {
      // sygnal-check's model of undo() options (sygnal-check/src/model/behaviors.js, owned by
      // 4-G2) doesn't list `coalesce` yet: its SYG127 for that option is expected until it does
      const found = check(name, code).filter(f => !/^SYG127 behavior 'undo' .* has no option 'coalesce'/.test(f))
      expect(WHOLE.has(name) ? found : found.filter(f => /^SYG[57]\d\d /.test(f))).toEqual([])
    })
  }
})

describe('advanced/undo: coalesce', () => {
  it('typing is one step; two quick Larger clicks are two (REPORT-v4 27-t3)', async () => {
    vi.useFakeTimers()
    try {
      const { mod: { Poster } } = await load({ 'Poster.jsx': SAMPLES.poster.code }, 'Poster.jsx')
      t = renderComponent(Poster, { strict: true })
      await t.ready()
      for (const v of ['S', 'Sa', 'Sal', 'Sale']) { t.simulateEvent('.headline', 'input', { value: v }); await t.next(s => s.poster.headline === v); await vi.advanceTimersByTimeAsync(100) }
      t.simulateEvent('.larger', 'click'); await t.next(s => s.poster.size === 28); await vi.advanceTimersByTimeAsync(50)
      t.simulateEvent('.larger', 'click'); await t.next(s => s.poster.size === 32)
      expect(t.state.history.past).toHaveLength(3)
      t.simulateEvent('.undo', 'click'); await t.next(s => s.poster.size === 28)
      t.simulateEvent('.undo', 'click'); await t.next(s => s.poster.size === 24 && s.poster.headline === 'Sale')
      t.simulateEvent('.undo', 'click'); await t.next(s => s.poster.headline === '')
      expect(t.html()).toContain('font-size: 24px')
      t.simulateEvent('.redo', 'click'); await t.next(s => s.poster.headline === 'Sale')
      t.expectNoDiagnostics()
    } finally { vi.useRealTimers() }
  })
})
