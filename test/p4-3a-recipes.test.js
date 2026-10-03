// @vitest-environment jsdom
// PLAN-4 3-A: the docs recipes for element commands ("focus the first invalid field", "a native
// dialog"), run verbatim (PLAN-4 §1.4). Each RECIPES entry is the exact code block for the docs
// (4-B copies it): compiled with the automatic JSX runtime (jsxImportSource 'sygnal', as
// sygnal/vite does), imported against the built package (dist: run `npm run build` first),
// exercised with renderComponent in the mock and the real DOM, and checked with
// `sygnal-check --strict` (strict-clean and a11y-clean).
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import ts from 'typescript'
import { renderComponent } from 'sygnal'
import { checkFiles } from '../sygnal-check/src/index.js'

const here = path.dirname(fileURLToPath(import.meta.url))

export const RECIPES = {
  // ── guide: focus the first invalid field ─────────────────────────────────
  focusInvalid: `import { controls, ABORT } from 'sygnal'

const { Name, Email, Submit } = controls({ Name: 'input', Email: 'input', Submit: 'button' })

const validate = ({ name, email }) => ({
  ...(name.trim() ? {} : { name: 'Enter your name' }),
  ...(email.includes('@') ? {} : { email: 'Enter an email address' }),
})

export function Signup({ state }) {
  return (
    <form>
      <label>Name <Name value={state.name} /></label>
      {state.errors.name && <p className="error">{state.errors.name}</p>}
      <label>Email <Email type="email" value={state.email} /></label>
      {state.errors.email && <p className="error">{state.errors.email}</p>}
      <Submit type="button">Sign up</Submit>
    </form>
  )
}

Signup.initialState = { name: '', email: '', errors: {} }

Signup.intent = ({ DOM }) => ({
  NAME: DOM.input(Name).value(),
  EMAIL: DOM.input(Email).value(),
  SUBMIT: DOM.click(Submit),
})

Signup.model = {
  NAME: (state, name) => ({ ...state, name }),
  EMAIL: (state, email) => ({ ...state, email }),
  SUBMIT: {
    STATE: (state) => ({ ...state, errors: validate(state) }),
    // runs after the errors have rendered; the first invalid field gets the focus
    ELEMENT: (state) => {
      const errors = validate(state)
      if (errors.name) return { focus: Name }
      if (errors.email) return { focus: Email }
      return ABORT
    },
  },
}
`,

  // ── guide: a native dialog ───────────────────────────────────────────────
  dialog: `import { controls } from 'sygnal'

const { HelpDialog, OpenHelp, CloseHelp } = controls({
  HelpDialog: 'dialog',
  OpenHelp: 'button',
  CloseHelp: 'button',
})

export function Help({ state }) {
  return (
    <div>
      <OpenHelp>Keyboard shortcuts</OpenHelp>
      <HelpDialog>
        <h2>Keyboard shortcuts</h2>
        <p>Press N for a new card.</p>
        <CloseHelp>Close</CloseHelp>
      </HelpDialog>
      <p className="status">{state.status}</p>
    </div>
  )
}

Help.initialState = { status: 'Help is closed' }

Help.intent = ({ DOM }) => ({
  OPEN_HELP: DOM.click(OpenHelp),
  CLOSE_HELP: DOM.click(CloseHelp),
  // close doesn't bubble; Sygnal listens on the dialog itself (Escape closes it too)
  HELP_CLOSED: DOM.close(HelpDialog),
})

Help.model = {
  OPEN_HELP: {
    STATE: (state) => ({ ...state, status: 'Help is open' }),
    ELEMENT: { showModal: HelpDialog },
  },
  CLOSE_HELP: { ELEMENT: { close: HelpDialog, returnValue: 'done' } },
  HELP_CLOSED: (state) => ({ ...state, status: 'Help is closed' }),
}
`,
}

let dir
const mods = {}
beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(here, '.p4-3a-recipes-'))
  for (const [name, src] of Object.entries(RECIPES)) {
    fs.writeFileSync(path.join(dir, name + '.jsx'), src)
    // (esbuild can't run under jsdom; TypeScript's transpiler gives the same automatic-runtime output)
    const { outputText: code } = ts.transpileModule(src, { fileName: name + '.jsx', compilerOptions: {
      jsx: ts.JsxEmit.ReactJSX, jsxImportSource: 'sygnal', module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020, allowJs: true,
    } })
    fs.writeFileSync(path.join(dir, name + '.mjs'), code)
    mods[name] = await import(pathToFileURL(path.join(dir, name + '.mjs')).href)
  }
})
afterAll(() => { if (dir) fs.rmSync(dir, { recursive: true, force: true }) })

let t
afterEach(() => { try { t?.dispose() } catch (_) {} t = null })

const control = (key) => `[data-control="${key}"]`

describe('the recipes are strict-clean and a11y-clean (sygnal-check --strict)', () => {
  for (const name of Object.keys(RECIPES)) {
    it(name, () => {
      const d = checkFiles([path.join(dir, name + '.jsx')], { cwd: dir, strict: true })
      expect(d.map(x => `${x.code} ${x.message}`)).toEqual([])
    })
  }
})

describe('focus the first invalid field', () => {
  it('mock DOM: the command is recorded', async () => {
    t = renderComponent(mods.focusInvalid.Signup)
    await t.ready()
    t.simulateEvent(control('Name'), 'input', { value: 'Ada' })
    await t.next(s => s.name === 'Ada')
    t.simulateEvent(control('Submit'), 'click')
    await t.next(s => !!s.errors.email)
    await t.settle()
    expect(t.commands('ELEMENT').map(c => Object.keys(c)[0] + ':' + c[Object.keys(c)[0]])).toEqual(['focus:[data-control="Email"]'])
    t.expectNoDiagnostics()
  })

  it('real DOM: the first invalid field has the focus, after the errors rendered', async () => {
    t = renderComponent(mods.focusInvalid.Signup, { dom: 'real' })
    await t.ready()
    t.simulateEvent(control('Submit'), 'click')
    await t.next(s => !!s.errors.name)
    await t.settle()
    expect(document.activeElement).toBe(t.query(control('Name')))
    expect(t.queryAll('.error').map(p => p.textContent)).toEqual(['Enter your name', 'Enter an email address'])
    t.simulateEvent(control('Name'), 'input', { value: 'Ada' })
    await t.next(s => s.name === 'Ada')
    t.simulateEvent(control('Submit'), 'click')
    await t.next(s => !s.errors.name)
    await t.settle()
    expect(document.activeElement).toBe(t.query(control('Email')))
    t.expectNoDiagnostics()
  })
})

describe('a native dialog', () => {
  it('mock DOM: showModal and close are recorded; close reaches intent', async () => {
    t = renderComponent(mods.dialog.Help)
    await t.ready()
    t.simulateEvent(control('OpenHelp'), 'click')
    await t.next(s => s.status === 'Help is open')
    t.simulateEvent(control('CloseHelp'), 'click')
    await t.settle()
    expect(t.commands('ELEMENT').map(c => Object.keys(c))).toEqual([['showModal'], ['close', 'returnValue']])
    t.simulateEvent(control('HelpDialog'), 'close')
    await t.next(s => s.status === 'Help is closed')
    t.expectNoDiagnostics()
  })

  it('real DOM: the dialog opens and closes; its close event updates the state', async () => {
    t = renderComponent(mods.dialog.Help, { dom: 'real' })
    await t.ready()
    const dialog = t.query(control('HelpDialog'))
    t.simulateEvent(control('OpenHelp'), 'click')
    await t.next(s => s.status === 'Help is open')
    await t.settle()
    expect(dialog.open).toBe(true)
    t.simulateEvent(control('CloseHelp'), 'click')
    await t.next(s => s.status === 'Help is closed')
    expect(dialog.open).toBe(false)
    expect(dialog.returnValue).toBe('done')
    t.expectNoDiagnostics()
  })
})
