/**
 * PLAN-5 1-F (D197, D199): sygnal-check and the defineBehavior extensions.
 *
 *   factories   uses follows a factory function that passes its options on
 *               ((opts) => base(opts), defaults spread before opts, an inline defineBehavior):
 *               option typos (SYG127) and unknown host entries (SYG102) as for a direct use;
 *               a wrapper that changes the options is opaque (no findings)
 *   timers      a behavior's timers: their actions are triggers (SYG102); options read only
 *               there, or in model handlers (5th parameter), are known options (SYG127)
 *   HOST        a HOST entry is a STATE reducer (no SYG609 for a 'HOST' sink)
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
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sygnal-check-p5-1f-'))
  for (const [rel, src] of Object.entries(files)) {
    const p = path.join(tmp, rel)
    fs.mkdirSync(path.dirname(p), { recursive: true })
    fs.writeFileSync(p, src)
  }
  return checkFiles(Object.keys(files).map(f => path.join(tmp, f)), { cwd: tmp, ignore: A11Y, ...opts })
}
const codes = (diags) => diags.map(d => `${d.code} ${d.severity}`).sort()
const only = (diags, code) => diags.filter(d => d.code === code)

const TIP = `import { defineBehavior } from 'sygnal'
const base = defineBehavior({
  initialState: { pending: false, open: false },
  intent: ({ DOM }, { target }) => ({ ENTER: DOM.mouseenter(target), LEAVE: DOM.mouseleave(target) }),
  timers: (slice, { delay }) => ({ show: slice.pending && { after: delay, action: 'SHOW' } }),
  model: {
    ENTER: (slice) => ({ ...slice, pending: true }),
    LEAVE: (slice) => ({ ...slice, pending: false, open: false }),
    SHOW: (slice) => ({ ...slice, pending: false, open: true }),
  },
})
export const tooltip = (opts) => base(opts)
export const tooltipWithDefaults = (opts = {}) => base({ delay: 300, ...opts })
export const inlineTip = (opts) => defineBehavior({
  initialState: { open: false },
  intent: ({ DOM }, { target }) => ({ TOGGLE: DOM.click(target) }),
  model: { TOGGLE: (s) => ({ ...s, open: !s.open }) },
})(opts)
export const renamedTip = (opts) => base({ target: opts.el, delay: opts.wait })
`

const HOST = (usesLine, extra = '') => `import { tooltip, tooltipWithDefaults, inlineTip, renamedTip } from './tip.js'
export function Card({ state }) {
  return <div><button className="help">?</button>{state.tip.open && <p>Help</p>}</div>
}
${usesLine}
${extra}
`

describe('D199: uses through factory functions', () => {
  it('(opts) => base(opts): a correct use has no findings', () => {
    expect(check({ 'tip.js': TIP, 'Card.jsx': HOST("Card.uses = { tip: tooltip({ target: '.help', delay: 500 }) }") })).toEqual([])
  })

  it('(opts) => base(opts): an option typo is SYG127 with the suggestion', () => {
    const d = check({ 'tip.js': TIP, 'Card.jsx': HOST("Card.uses = { tip: tooltip({ target: '.help', deley: 500 }) }") })
    expect(codes(d)).toEqual(['SYG127 error'])
    expect(d[0].message).toContain("behavior 'tooltip'")
    expect(d[0].message).toContain("did you mean 'delay'")
  })

  it("(opts) => base(opts): a host entry for an action the behavior lacks is SYG102 naming its actions", () => {
    const d = check({ 'tip.js': TIP, 'Card.jsx': HOST("Card.uses = { tip: tooltip({ target: '.help' }) }", "Card.model = { 'tip.SHOW': { EFFECT: () => {} }, 'tip.HIDE': { EFFECT: () => {} } }") })
    expect(codes(d)).toEqual(['SYG102 warn'])
    expect(d[0].message).toContain("has no action 'HIDE'")
    expect(d[0].message).toContain('SHOW')
  })

  it('defaults spread before the options, and an inline defineBehavior: as direct uses', () => {
    expect(check({ 'tip.js': TIP, 'Card.jsx': HOST("Card.uses = { tip: tooltipWithDefaults({ target: '.help' }) }") })).toEqual([])
    expect(codes(check({ 'tip.js': TIP, 'Card.jsx': HOST("Card.uses = { tip: tooltipWithDefaults({ targte: '.help' }) }") }))).toEqual(['SYG127 error'])
    expect(check({ 'tip.js': TIP, 'Card.jsx': HOST("Card.uses = { tip: inlineTip({ target: '.help' }) }", "Card.model = { 'tip.TOGGLE': { EFFECT: () => {} } }") })).toEqual([])
    const d = check({ 'tip.js': TIP, 'Card.jsx': HOST("Card.uses = { tip: inlineTip({ target: '.help' }) }", "Card.model = { 'tip.TOGLE': { EFFECT: () => {} } }") })
    expect(codes(d)).toEqual(['SYG102 warn'])
  })

  it('a wrapper that changes the options is opaque: no findings', () => {
    expect(check({ 'tip.js': TIP, 'Card.jsx': HOST("Card.uses = { tip: renamedTip({ el: '.help', wait: 5 }) }", "Card.model = { 'tip.ANYTHING': { EFFECT: () => {} } }") })).toEqual([])
  })

  it('a wrapper used uncalled is SYG127 (not a behavior)', () => {
    const d = check({ 'tip.js': TIP, 'Card.jsx': HOST('Card.uses = { tip: tooltip }') })
    expect(codes(d)).toEqual(['SYG127 error'])
  })
})

describe('D197: timers, options in handlers, HOST', () => {
  const BEH = `import { defineBehavior, ABORT } from 'sygnal'
export const reorder = defineBehavior({
  initialState: { moves: 0, pending: false },
  timers: (slice, { ping, every }) => ({ ping: slice.pending && { every, action: ping }, done: slice.pending && { after: 10, action: 'SETTLE' } }),
  model: {
    UP: { HOST: (state, id, next, props, { from }, key) => (state[from].length ? { ...state, [from]: [...state[from]].reverse() } : ABORT) },
    SETTLE: (s, d, next, props, options) => ({ ...s, pending: false, by: options.label }),
  },
})
`
  const host = (opts, extra = '') => `import { reorder } from './reorder.js'
export function List({ state }) { return <ul>{state.items.map(i => <li>{i}</li>)}</ul> }
List.initialState = { items: [] }
List.uses = { order: reorder(${opts}) }
${extra}
`
  it("options read only in timers or a model handler's 5th parameter are known; HOST is a STATE reducer", () => {
    const d = check({ 'reorder.js': BEH, 'List.jsx': host("{ from: 'items', ping: 'PINGED', every: 100, label: 'x' }", 'List.model = { PINGED: (s) => s }') })
    expect(d).toEqual([])
    const typo = check({ 'reorder.js': BEH, 'List.jsx': host("{ fron: 'items', ping: 'PINGED', every: 100 }", 'List.model = { PINGED: (s) => s }') })
    expect(codes(typo)).toEqual(['SYG127 error'])
    expect(typo[0].message).toContain("did you mean 'from'")
  })

  it("a timer action naming the behavior's own action, or a literal host action, triggers it", () => {
    const LIT = BEH.replace('action: ping }', "action: 'PINGED' }").replace('{ ping, every }', '{ every }')
    expect(check({ 'reorder.js': LIT, 'List.jsx': host("{ from: 'items', every: 100 }", "List.model = { PINGED: (s) => s, 'order.SETTLE': { EFFECT: () => {} } }") })).toEqual([])
    const d = check({ 'reorder.js': LIT, 'List.jsx': host("{ from: 'items', every: 100 }", 'List.model = { PINGED: (s) => s, PONGED: (s) => s }') })
    expect(only(d, 'SYG102').map(x => x.data.action)).toEqual(['PONGED'])
    // a timer action from an option: the use's literal value triggers it
    const opt = check({ 'reorder.js': BEH, 'List.jsx': host("{ from: 'items', ping: 'PINGED', every: 100 }", 'List.model = { PINGED: (s) => s, PONGED: (s) => s }') })
    expect(only(opt, 'SYG102').map(x => `${x.data.action} ${x.severity}`)).toEqual(['PONGED warn'])
    // a non-literal value: unknown name, so SYG102 is downgraded to info
    const dyn = check({ 'reorder.js': BEH, 'List.jsx': host("{ from: 'items', ping: NAME, every: 100 }", "const NAME = 'PIN' + 'GED'\nList.model = { PINGED: (s) => s, PONGED: (s) => s }") })
    expect(only(dyn, 'SYG102').map(x => `${x.data.action} ${x.severity}`)).toEqual(['PINGED info', 'PONGED info'])
  })
})
