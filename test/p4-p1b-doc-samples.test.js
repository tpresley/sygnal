// @vitest-environment jsdom
// PLAN-4 P-1b (GS-12): the code samples of docs guide/view-transitions.md, run verbatim (as
// test/p4-4b1-doc-samples.test.js does). The blocks are read from the page itself, so a sample
// can't drift from what runs here; they are compiled with the automatic JSX runtime
// (jsxImportSource 'sygnal'), imported against the built package (dist: `npm run build` first)
// and exercised under jsdom with a fake document.startViewTransition. Fragments get a prelude or
// an epilogue here; the sample text is unchanged. Every JS sample is also checked with
// `sygnal-check --strict`. The CSS recipe runs in the real-browser suite
// (browser-tests view-transitions-p1b.jsx).
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import ts from 'typescript'
import { checkFiles } from '../sygnal-check/src/index.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const page = fs.readFileSync(path.join(here, '../docs/src/content/docs/guide/view-transitions.md'), 'utf8')
const blocks = [...page.matchAll(/^```(\w+)\n([\s\S]*?)^```$/gm)].map(m => ({ lang: m[1], code: m[2] }))
const pick = (re) => {
  const found = blocks.filter(b => re.test(b.code))
  if (found.length != 1) throw new Error(`expected one block matching ${re}, found ${found.length}`)
  return found[0].code
}

const S = {
  card: pick(/^\/\/ Card\.jsx/),
  board: pick(/^\/\/ Board\.jsx/),
  main: pick(/^import \{ run, makeViewTransitionDOMDriver \}/),
  route: pick(/^App\.route = 'ROUTE'/),
  test: pick(/^import \{ renderComponent \}/),
  css: pick(/::view-transition-group\(\*\.card\)/),
  intro: pick(/^Board\.viewTransitions = \['MOVE'\]\n$/),
}

let dir
let n = 0
const compile = (src, file) => ts.transpileModule(src, { fileName: file, compilerOptions: {
  jsx: ts.JsxEmit.ReactJSX, jsxImportSource: 'sygnal', module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, allowJs: true,
} }).outputText.replace(/(from\s+['"]\.{1,2}\/[^'"]+?)\.jsx?(['"])/g, '$1.mjs$2')

async function load(files, main) {
  const base = path.join(dir, 'm' + (n++))
  for (const [rel, src] of Object.entries(files)) {
    const file = path.join(base, rel)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, src)
    fs.writeFileSync(file.replace(/\.jsx?$/, '.mjs'), compile(src, rel))
  }
  return import(pathToFileURL(path.join(base, main.replace(/\.jsx?$/, '.mjs'))).href)
}

beforeAll(() => { dir = fs.mkdtempSync(path.join(here, '.p4-p1b-samples-')) })
afterAll(() => { if (dir) fs.rmSync(dir, { recursive: true, force: true }) })

const calls = []
afterEach(() => { calls.length = 0; delete document.startViewTransition })
function fakeVT() {
  document.startViewTransition = (update) => {
    const t = {}
    calls.push(t)
    t.updateCallbackDone = new Promise(r => setTimeout(r, 0)).then(() => update())
    return t
  }
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const until = async (cond, what, ms = 3000) => {
  for (const end = Date.now() + ms; !cond(); await sleep(5)) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`)
  }
}
const titles = (lane) => [...document.querySelectorAll(`[style*="lane-${lane}"] .card span`)].map(s => s.textContent)

describe('guide/view-transitions samples', () => {
  it('found every sample on the page', () => {
    expect(Object.values(S).every(Boolean)).toBe(true)
  })

  it('sygnal-check --strict: the recipe (Card.jsx, Board.jsx, main.js) has no finding', () => {
    const base = path.join(dir, 'check-recipe')
    fs.mkdirSync(base, { recursive: true })
    fs.writeFileSync(path.join(base, 'Card.jsx'), S.card)
    fs.writeFileSync(path.join(base, 'Board.jsx'), S.board)
    fs.writeFileSync(path.join(base, 'main.js'), S.main)
    const d = checkFiles([base], { cwd: base, strict: true })
    expect(d.map(x => `${x.code} ${x.message}`)).toEqual([])
  })

  it('sygnal-check --strict: the fragments have no strict or a11y finding', () => {
    for (const [name, code] of [['route', S.route], ['test', S.test], ['intro', S.intro]]) {
      const file = path.join(dir, 'check', name + '.jsx')
      fs.mkdirSync(path.dirname(file), { recursive: true })
      fs.writeFileSync(file, code)
      const found = checkFiles([file], { cwd: path.dirname(file), strict: true }).map(d => `${d.code} ${d.message}`)
      expect(found.filter(f => /^SYG[57]\d\d /.test(f))).toEqual([])
    }
  })

  it('the recipe: run() with the View Transition driver; Move runs one transition and moves the card across', async () => {
    fakeVT()
    document.body.innerHTML = '<div id="root"></div>'
    await load({ 'Card.jsx': S.card, 'Board.jsx': S.board, 'main.js': S.main }, 'main.js')
    await until(() => titles('todo').length == 2, 'the first render')
    expect(titles('todo')).toEqual(['Write the docs', 'Ship it'])
    expect(titles('done')).toEqual([])
    const card = document.querySelector('.card')
    expect(card.style.viewTransitionName).toBe('card-1')
    document.querySelector('.card .move').click()
    await until(() => titles('done').length == 1, 'the move')
    expect(calls.length).toBe(1)
    await calls[0].updateCallbackDone
    expect(titles('todo')).toEqual(['Ship it'])
    expect(titles('done')).toEqual(['Write the docs'])
    // and back
    document.querySelector('[style*="lane-done"] .move').click()
    await until(() => titles('todo').length == 2, 'the move back')
    expect(titles('todo')).toEqual(['Ship it', 'Write the docs'])
    expect(calls.length).toBe(2)
    document.body.innerHTML = ''
  })

  it('the testing snippet runs: MOVE through simulateAction', async () => {
    const { t } = await load({ 'Card.jsx': S.card, 'Board.jsx': S.board, 'Board.test.jsx': S.test + '\nexport { t }\n' }, 'Board.test.jsx')
    expect(t.state.done).toEqual([{ id: 1, title: 'Write the docs' }])
    expect(t.state.todo).toEqual([{ id: 2, title: 'Ship it' }])
    t.dispose()
  })

  it('the CSS recipe names the classes the recipe sets', () => {
    expect(S.board).toContain("viewTransitionClass: 'lane'")
    expect(S.card).toContain("viewTransitionClass: 'card'")
    expect(S.css).toMatch(/::view-transition-new\(\*\.lane\)/)
  })
})
