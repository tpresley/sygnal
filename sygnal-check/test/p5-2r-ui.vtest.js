/**
 * PLAN-5 2-R, G-392: sygnal-check and the sygnal/ui parts. <Toaster /> selects TOAST and
 * TOAST_DISMISS (no SYG105 for an app that emits them); dialog, popover, tooltip, tabs,
 * accordion and disclosure are first-party behaviors (FIRST_PARTY): option typos are SYG127,
 * their selectors are listened to and checked against the view (SYG110), and their actions
 * (host entries 'key.ACTION') are known (SYG102 for a slip).
 */
import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { checkFiles } from '../src/index.js'

let tmp
afterEach(() => { if (tmp) fs.rmSync(tmp, { recursive: true, force: true }); tmp = null })

const A11Y = ['SYG701', 'SYG702', 'SYG703', 'SYG704', 'SYG705', 'SYG706', 'SYG707', 'SYG708']
function check(files, opts = {}) {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sygnal-check-p5-2r-'))
  for (const [rel, src] of Object.entries(files)) {
    const p = path.join(tmp, rel)
    fs.mkdirSync(path.dirname(p), { recursive: true })
    fs.writeFileSync(p, src)
  }
  return checkFiles(Object.keys(files).map(f => path.join(tmp, f)), { cwd: tmp, ignore: A11Y, ...opts })
}
const codes = (diags) => diags.map(d => `${d.code} ${d.severity}`).sort()

describe('Toaster (SYG105)', () => {
  const APP = (imp, emits = "SAVE: { EVENTS: event('TOAST', { text: 'Saved', kind: 'success' }) }, CLEAR: { EVENTS: event('TOAST_DISMISS') }") => `import { event } from 'sygnal'
${imp}
export function App() {
  return <main><button className="save">Save</button><button className="clear">Clear</button>${imp ? '<Toaster />' : ''}</main>
}
App.initialState = {}
App.intent = ({ DOM }) => ({ SAVE: DOM.click('.save'), CLEAR: DOM.click('.clear') })
App.model = { ${emits} }
`

  it('an app rendering <Toaster /> from sygnal/ui that emits TOAST / TOAST_DISMISS: no findings', () => {
    expect(check({ 'App.jsx': APP("import { Toaster } from 'sygnal/ui'") })).toEqual([])
  })

  it('Toaster imported but TOAST_DISMISS never emitted: not reported (the Toaster selects it implicitly)', () => {
    expect(check({ 'App.jsx': APP("import { Toaster } from 'sygnal/ui'", "SAVE: { EVENTS: event('TOAST', 'Saved') }, CLEAR: { EFFECT: () => {} }") })).toEqual([])
  })

  it('without the Toaster, an emitted TOAST nobody selects is still SYG105', () => {
    const d = check({ 'App.jsx': APP('') })
    expect(codes(d)).toEqual(['SYG105 warn', 'SYG105 warn'])
    expect(d.map(x => x.data.type).sort()).toEqual(['TOAST', 'TOAST_DISMISS'])
  })
})

const HOST = (name, uses, view, extra = '') => `import { ${name} } from 'sygnal/ui'
export function Host({ state, uid }) {
  return ${view}
}
Host.initialState = {}
Host.uses = { ${uses} }
${extra}
`

const CASES = {
  dialog: HOST('dialog', "prefs: dialog({ dialog: '.prefs', trigger: '.open-prefs', close: '.close-prefs' })",
    `<div><button className="open-prefs">Settings</button><dialog className="prefs" aria-labelledby={uid('t')}><h2 id={uid('t')}>Settings</h2><button className="close-prefs">Close</button></dialog></div>`),
  popover: HOST('popover', "filters: popover({ popover: '.filters', close: '.filters-done' })",
    `<div><button popovertarget={uid('f')}>Filters</button><div className="filters" id={uid('f')} popover="auto"><button className="filters-done">Done</button></div></div>`),
  tooltip: HOST('tooltip', "tip: tooltip({ trigger: '.save', tip: '.save-tip', showDelay: 300 })",
    `<div><button className="save" aria-describedby={uid('tip')}>Save</button><div className="save-tip" id={uid('tip')} role="tooltip" popover="manual">Saves</div></div>`),
  tabs: HOST('tabs, tabsAttrs', "tabs: tabs({ tab: '.tab', selected: 'a' })",
    `(() => { const a = tabsAttrs(state.tabs, uid); return <div><div {...a.list} aria-label="T"><button className="tab" {...a.tab('a')}>A</button></div><section {...a.panel('a')}>A</section></div> })()`),
  accordion: HOST('accordion, accordionAttrs', "faq: accordion({ trigger: '.faq-trigger', multiple: true })",
    `(() => { const a = accordionAttrs(state.faq, uid); return <div><h3><button className="faq-trigger" {...a.trigger('x')}>X</button></h3><div {...a.panel('x')}>x</div></div> })()`),
  disclosure: HOST('disclosure, disclosureAttrs', "more: disclosure({ trigger: '.more-toggle', open: false })",
    `(() => { const a = disclosureAttrs(state.more, uid); return <div><button className="more-toggle" {...a.trigger}>More</button><div {...a.panel}>…</div></div> })()`),
}

describe('sygnal/ui behaviors (FIRST_PARTY)', () => {
  for (const [name, src] of Object.entries(CASES)) {
    it(`${name}: the canonical use has no findings`, () => {
      expect(check({ 'Host.jsx': src })).toEqual([])
    })
  }

  it('an option typo is SYG127 with the suggestion', () => {
    const d = check({ 'Host.jsx': CASES.dialog.replace("close: '.close-prefs'", "clse: '.close-prefs'") })
    expect(codes(d)).toContain('SYG127 error')
    const e = d.find(x => x.code === 'SYG127')
    expect(e.message).toContain("no option 'clse'")
    expect(e.message).toContain("did you mean 'close'")
  })

  it('options of each part: a typo in each is caught', () => {
    const typos = {
      popover: ["popover: '.filters'", "popovr: '.filters'", 'popover'],
      tooltip: ['showDelay: 300', 'showDelai: 300', 'showDelay'],
      tabs: ["selected: 'a'", "selectd: 'a'", 'selected'],
      accordion: ['multiple: true', 'multple: true', 'multiple'],
      disclosure: ['open: false', 'opn: false', 'open'],
    }
    for (const [name, [from, to, want]] of Object.entries(typos)) {
      const d = check({ 'Host.jsx': CASES[name].replace(from, to) })
      const e = d.find(x => x.code === 'SYG127')
      expect(e?.message, name).toContain(`did you mean '${want}'`)
    }
  })

  it('a trigger the view never renders is SYG110 (info for a class selector, as for pager)', () => {
    const d = check({ 'Host.jsx': CASES.disclosure.replace("trigger: '.more-toggle'", "trigger: '.more-toggel'") })
    expect(codes(d)).toEqual(['SYG110 info'])
    expect(d[0].message).toContain("behavior 'more'")
  })

  it("host entries for the parts' actions are known ('prefs.CLOSED'); a slip is SYG102", () => {
    const ok = CASES.dialog + "Host.model = { 'prefs.CLOSED': { EFFECT: () => {} }, 'prefs.CANCEL': { EFFECT: () => {} } }\n"
    expect(check({ 'Host.jsx': ok })).toEqual([])
    const tip = CASES.tooltip + "Host.model = { 'tip.SHOW': { EFFECT: () => {} }, 'tip.ESCAPE': { EFFECT: () => {} } }\n"
    expect(check({ 'Host.jsx': tip })).toEqual([])
    const d = check({ 'Host.jsx': CASES.dialog + "Host.model = { 'prefs.CLOSD': { EFFECT: () => {} } }\n" })
    expect(codes(d)).toEqual(['SYG102 warn'])
    expect(d[0].message).toContain("no action 'CLOSD'")
  })
})
