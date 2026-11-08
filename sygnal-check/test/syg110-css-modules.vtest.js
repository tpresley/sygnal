/**
 * SYG110 for a CSS Module's class (rules/syg110-selector-in-view.js, strings.js cssModuleClasses):
 * `className={s.save}` renders a hashed name, so DOM.click('.save') never fires. A visible warn,
 * not the "a dynamic value might produce it" info.
 */
import { describe, it, expect } from 'vitest'
import os from 'node:os'
import path from 'node:path'
import { checkFiles } from '../src/index.js'

const ROOT = path.join(os.tmpdir(), 'sygnal-check-syg110-modules-virtual-does-not-exist')
const FILE = path.join(ROOT, 'App.jsx')
const app = ({ imp = "import s from './x.module.css'", className, selector = "'.save'", more = '' }) => `import { run } from 'sygnal'
${imp}
${more}
function App({ state, ...props }) { return <button className=${className}>x</button> }
App.initialState = {}
App.intent = ({ DOM }) => ({ SAVE: DOM.click(${selector}) })
App.model = { SAVE: (st) => st }
run(App)
`
const found = (o) => checkFiles([FILE], { cwd: ROOT, sources: { [FILE]: app(o) } }).filter(d => d.code === 'SYG110')

describe('SYG110: a CSS Module class as the event hook', () => {
  it.each([
    ['a default import', { className: '{s.save}' }],
    ["computed access", { className: "{s['save']}" }],
    ['a namespace import', { imp: "import * as s from './x.module.css'", className: '{s.save}' }],
    ['a named import', { imp: "import { save } from './x.module.css'", className: '{save}' }],
    ['a template literal', { className: '{`${s.save}`}' }],
    ['a template with another module read', { className: '{`${s.save} ${s.big}`}' }],
    ['a clsx call', { className: '{clsx(s.save, state.on && s.big)}', more: "import clsx from 'clsx'" }],
    ['an unknown call using it', { className: '{twMerge("px-2", s.save)}', more: "import { twMerge } from 'tailwind-merge'" }],
    ['.scss', { imp: "import s from './x.module.scss'", className: '{s.save}' }],
    ['.sass', { imp: "import s from './x.module.sass'", className: '{s.save}' }],
    ['.less', { imp: "import s from './x.module.less'", className: '{s.save}' }],
    ['.styl', { imp: "import s from './x.module.styl'", className: '{s.save}' }],
    ['a kebab selector read in camelCase', { className: '{s.saveBtn}', selector: "'.save-btn'" }],
    ['a member beside another dynamic class', { className: '{`${s.save} ${state.x}`}' }],
  ])('warns for %s', (_, o) => {
    const [d, ...rest] = found(o)
    expect(rest).toEqual([])
    expect(d.severity).toBe('warn')
    expect(d.message).toContain('CSS Module')
    expect(d.message).toContain('hashed')
    expect(d.fix).toContain('hook class')
    expect(d.fix).toContain('control')
    expect(d.related).toHaveLength(1)
  })

  it('names the fix from the expression read', () => {
    const [d] = found({ className: '{s.save}' })
    expect(d.fix).toContain('className={`save ${s.save}`}')
    expect(d.fix).toContain('DOM.click(`.${s.save}`)')
  })

  it('warns when the only dynamic classes are module reads, though no member matches the selector', () => {
    const [d] = found({ className: '{s.primary}' })
    expect(d.severity).toBe('warn')
    expect(d.message).toContain("only dynamic classes come from a CSS Module")
  })

  it('a stable hook beside the module class works', () => {
    expect(found({ className: '{`save ${s.save}`}' })).toEqual([])
  })

  it('selecting the hashed name works (info: a dynamic selector, as for any)', () => {
    for (const d of found({ className: '{s.save}', selector: '`.${s.save}`' })) expect(d.severity).toBe('info')
  })

  it('a control with the module class works', () => {
    const src = `import { run, controls } from 'sygnal'
import s from './x.module.css'
const { Save } = controls({ Save: 'button' })
function App() { return <Save className={s.save}>x</Save> }
App.initialState = {}
App.intent = ({ DOM }) => ({ SAVE: DOM.click(Save) })
App.model = { SAVE: (st) => st }
run(App)
`
    expect(checkFiles([FILE], { cwd: ROOT, sources: { [FILE]: src } }).filter(d => d.code === 'SYG110')).toEqual([])
  })

  it.each([
    ['cva', { className: '{button({ on: state.on })}', more: "import { cva } from 'class-variance-authority'\nconst button = cva('save px-2', {})" }],
    ['twMerge', { className: '{twMerge("save px-2", s.save)}', more: "import { twMerge } from 'tailwind-merge'" }],
    ['a clsx helper call result', { className: '{clsx(base(), s.big)}', more: "import clsx from 'clsx'\nconst base = () => 'save'" }],
    ['a non-module dynamic class', { imp: "import s from './x.css'", className: '{s.save}' }],
    ['props', { imp: '', className: '{props.className}' }],
  ])('stays info for %s, whose text or value may produce it', (_, o) => {
    const [d, ...rest] = found(o)
    expect(rest).toEqual([])
    expect(d.severity).toBe('info')
    expect(d.message).toContain('dynamic')
  })

  it('a module read beside a spread stays info when no member matches', () => {
    const src = `import { run } from 'sygnal'
import s from './x.module.css'
function App(p) { return <button {...p} className={s.big}>x</button> }
App.initialState = {}
App.intent = ({ DOM }) => ({ SAVE: DOM.click('.save') })
App.model = { SAVE: (st) => st }
run(App)
`
    const [d] = checkFiles([FILE], { cwd: ROOT, sources: { [FILE]: src } }).filter(x => x.code === 'SYG110')
    expect(d.severity).toBe('info')
  })

  it('a module read in a helper the view calls counts', () => {
    const src = `import { run } from 'sygnal'
import s from './x.module.css'
const row = ({ c }) => <li className={c}>x</li>
function App() { return <ul>{row({ c: s.save })}</ul> }
App.initialState = {}
App.intent = ({ DOM }) => ({ SAVE: DOM.click('.save') })
App.model = { SAVE: (st) => st }
run(App)
`
    const [d] = checkFiles([FILE], { cwd: ROOT, sources: { [FILE]: src } }).filter(x => x.code === 'SYG110')
    expect(d.severity).toBe('warn')
  })
})
