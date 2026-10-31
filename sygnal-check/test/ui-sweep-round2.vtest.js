/**
 * ui-sweep round 2 (dev-plans/research/ui-sweep/native.md):
 *
 *   SYG118   a host intent action named like a behavior action replaces the trigger the behavior
 *            builds from an option the host passed (first-party parts and a local defineBehavior);
 *            not when the option is left out, nor for an action no option builds
 *   SYG116   static: a sink entry that is a function returning event() / emit() from 'sygnal'
 */
import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { checkFiles } from '../src/index.js'

let tmp
afterEach(() => { if (tmp) fs.rmSync(tmp, { recursive: true, force: true }); tmp = null })

const A11Y = ['SYG701', 'SYG702', 'SYG703', 'SYG704', 'SYG705', 'SYG706', 'SYG707', 'SYG708']
function check(src) {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sygnal-check-ui-sweep-'))
  const p = path.join(tmp, 'App.jsx')
  fs.writeFileSync(p, src)
  return checkFiles([p], { cwd: tmp, ignore: A11Y })
}
const only = (diags, code) => diags.filter(d => d.code === code)

describe('SYG118', () => {
  it('a host intent replacing tabs.SELECT and dialog OPEN (options passed)', () => {
    const d = only(check(`import { tabs, tabsAttrs, dialog } from 'sygnal/ui'
export function S({ state, uid }) {
  const a = tabsAttrs(state.tabs, uid)
  return <div><button className="go">Go</button><button className="edit">Edit</button><div {...a.list}><button className="tab" {...a.tab('x')}>x</button></div><dialog className="d" /></div>
}
S.uses = { tabs: tabs({ tab: '.tab' }), d: dialog({ dialog: '.d', trigger: '.edit' }) }
S.intent = ({ DOM }) => ({ 'tabs.SELECT': DOM.click('.go').mapTo('x'), 'd.OPEN': DOM.click('.go') })
`), 'SYG118')
    expect(d.map(x => x.data.action).sort()).toEqual(['OPEN', 'SELECT'])
    expect(d[0].severity).toBe('warn')
    expect(d.find(x => x.data.action === 'SELECT').fix).toContain("tab: '.tab, .other'")
  })

  it('not when the option is left out (dialog without trigger, popover OPEN)', () => {
    const d = only(check(`import { dialog, popover } from 'sygnal/ui'
export function S() { return <div><button className="go">Go</button><dialog className="d" /><div className="p" popover="auto" /></div> }
S.uses = { d: dialog({ dialog: '.d' }), p: popover({ popover: '.p' }) }
S.intent = ({ DOM }) => ({ 'd.OPEN': DOM.click('.go'), 'p.OPEN': DOM.click('.go') })
`), 'SYG118')
    expect(d).toEqual([])
  })

  it('a local defineBehavior whose trigger comes from an option', () => {
    const d = only(check(`import { defineBehavior } from 'sygnal'
const toggler = defineBehavior({
  initialState: { on: false },
  intent: ({ DOM }, { button }) => ({ FLIP: DOM.click(button) }),
  model: { FLIP: (s) => ({ ...s, on: !s.on }) },
})
export function L({ state }) { return <div><button className="switch">{String(state.lamp.on)}</button><button className="other">o</button></div> }
L.uses = { lamp: toggler({ button: '.switch' }) }
L.intent = ({ DOM }) => ({ 'lamp.FLIP': DOM.click('.other') })
`), 'SYG118')
    expect(d).toHaveLength(1)
    expect(d[0].data).toEqual({ key: 'lamp', action: 'FLIP', option: 'button' })
  })
})

describe('SYG116 (static)', () => {
  it('EVENTS: (state) => event(...) and a PARENT function returning emit()', () => {
    const d = only(check(`import { event } from 'sygnal'
export function C() { return <button className="save">Save</button> }
C.intent = ({ DOM }) => ({ SAVE: DOM.click('.save') })
C.model = {
  SAVE: { EVENTS: (state) => event('SAVED', { at: 1 }) },
}
`), 'SYG116')
    expect(d).toHaveLength(1)
    expect(d[0].severity).toBe('error')
    expect(d[0].data).toMatchObject({ action: 'SAVE', sink: 'EVENTS', factory: 'event' })
  })

  it('not for the canonical form, nor a function that returns an event object', () => {
    const d = only(check(`import { event } from 'sygnal'
export function C() { return <button className="save">Save</button> }
C.intent = ({ DOM }) => ({ SAVE: DOM.click('.save'), OTHER: DOM.click('.save') })
C.model = {
  SAVE: { EVENTS: event('SAVED', (state) => ({ at: 1 })) },
  OTHER: { EVENTS: (state) => ({ type: 'OTHER', data: 1 }) },
}
`), 'SYG116')
    expect(d).toEqual([])
  })
})
