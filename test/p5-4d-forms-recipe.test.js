// PLAN-5 4-D (D231): the agent-sized guide/forms page. Its recipe (the first jsx block: validation,
// inline field-array rows with form.ADD / form.REMOVE, the submit to HTTP, the pending button, server
// errors) and its testing sample (the ```jsx block under "## Testing") run verbatim against the built
// package (dist: run `npm run build` first), compiled as sygnal/vite would (automatic JSX runtime).
// Both are also clean under `sygnal-check --strict`.
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import ts from 'typescript'
import 'sygnal/diagnostics'
import { renderComponent } from 'sygnal'
import { checkFiles } from '../sygnal-check/src/index.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const page = fs.readFileSync(path.join(here, '../docs/src/content/docs/guide/forms.md'), 'utf8')
const blocks = [...page.matchAll(/```jsx\n([\s\S]*?)```/g)].map((m) => m[1])
const RECIPE = blocks[0]
const TESTING = blocks.find((b) => b.includes("from 'vitest'"))

const compile = (src, file) => ts.transpileModule(src, { fileName: file, compilerOptions: {
  jsx: ts.JsxEmit.ReactJSX, jsxImportSource: 'sygnal', module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, allowJs: true,
} }).outputText.replace(/(from\s+['"]\.{1,2}\/[^'"]+?)\.jsx?(['"])/g, '$1.mjs$2')

let dir, t
beforeAll(() => {
  dir = fs.mkdtempSync(path.join(here, '.p5-4d-forms-'))
  // the testing sample's `it` registers its body here; `expect` is vitest's
  fs.writeFileSync(path.join(dir, 'vitest-shim.mjs'), "export { expect } from 'vitest'\nexport const it = (name, fn) => { globalThis.__p54dSamples.push(fn) }\n")
  fs.writeFileSync(path.join(dir, 'Signup.jsx'), RECIPE + '\nexport default Signup\n')
  fs.writeFileSync(path.join(dir, 'Signup.mjs'), compile(RECIPE + '\nexport default Signup\n', 'Signup.jsx'))
  fs.writeFileSync(path.join(dir, 'Signup.test.mjs'), compile(TESTING, 'Signup.test.jsx').replace(/from ['"]vitest['"]/, "from './vitest-shim.mjs'"))
})
afterAll(() => { if (dir) fs.rmSync(dir, { recursive: true, force: true }) })
afterEach(() => { try { t?.dispose() } catch (_) {} t = null })

const load = async () => (await import(pathToFileURL(path.join(dir, 'Signup.mjs')).href)).default

describe('guide/forms: the agent-sized page (D231)', () => {
  it('leads with the recipe; the page is small enough to read whole', () => {
    expect(page.indexOf('## The recipe')).toBeLessThan(1500)
    for (const s of ["'form.ADD'", "'form.REMOVE'", 'state.form.submitting', "error: 'form.ERRORS'", '422']) expect(page).toContain(s)
    expect(Buffer.byteLength(page)).toBeLessThan(18000)
  })

  it('the recipe and the testing sample are clean under sygnal-check --strict', () => {
    const files = [path.join(dir, 'Signup.jsx')]
    expect(checkFiles(files, { cwd: dir, strict: true }).map((d) => `${d.code} ${d.message}`)).toEqual([])
  })

  it('the testing sample passes against the recipe', async () => {
    globalThis.__p54dSamples = []
    await import(pathToFileURL(path.join(dir, 'Signup.test.mjs')).href)
    expect(globalThis.__p54dSamples).toHaveLength(1)
    await globalThis.__p54dSamples[0]()
  })

  it('inline rows: add, remove by data-id, renumber; pending; done; a failure without a message', async () => {
    const Signup = await load()
    t = renderComponent(Signup, { strict: true })
    await t.ready()
    expect(t.query('.remove').disabled).toBe(true)
    t.simulateEvent('.add', 'click')
    t.simulateEvent('.add', 'click')
    await t.settle()
    expect(t.state.form.values.addresses.map((r) => r.id)).toEqual([1, 2, 3])
    t.simulateEvent('[name="addresses.3.city"]', 'input', { value: 'Rome' })
    t.simulateEvent('.remove[data-id="2"]', 'click')
    await t.settle()
    expect(t.state.form.values.addresses).toEqual([{ id: 1, city: '' }, { id: 3, city: 'Rome' }])
    expect(t.queryAll('legend').map((l) => l.textContent)).toEqual(['Address 1', 'Address 2'])
    const ids = t.queryAll('input').map((i) => i.id)
    expect(new Set(ids).size).toBe(ids.length)

    // an invalid submit focuses the first invalid field and sends nothing
    t.simulateEvent('.signup', 'submit')
    await t.settle()
    expect(t.requests('HTTP')).toHaveLength(0)
    expect(t.commands('ELEMENT').at(-1).focus.within).toContain('[name="name"]')

    t.simulateEvent('[name="name"]', 'input', { value: 'Ada' })
    t.simulateEvent('[name="email"]', 'input', { value: 'ada@example.com' })
    t.simulateEvent('[name="addresses.1.city"]', 'input', { value: 'Oslo' })
    t.simulateEvent('.signup', 'submit')
    await t.settle()
    expect(t.state.form.submitting).toBe(true)
    expect(t.html()).toContain('Signing up…')
    t.simulateEvent('.signup', 'submit')   // dropped while pending
    await t.settle()
    expect(t.requests('HTTP')).toHaveLength(1)
    expect(t.requests('HTTP')[0].json.addresses).toEqual([{ city: 'Oslo' }, { city: 'Rome' }])

    await t.fail('HTTP', { status: 500, body: '' })
    expect(t.query('[role="alert"]').textContent).toBe('Request failed (500)')
    expect(t.state.form.submitting).toBe(false)

    t.simulateEvent('.signup', 'submit')
    await t.settle()
    await t.respond('HTTP', { id: 'A-7' })
    expect(t.query('.done').textContent).toBe('Account A-7 created.')
    expect(t.state.form.dirty).toBe(false)
    t.expectNoDiagnostics()
  })
})
