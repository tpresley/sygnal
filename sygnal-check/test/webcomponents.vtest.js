/**
 * PLAN-5 spike 0-S6 (W-3, S-10): web components (Web Awesome) in sygnal-check.
 *
 * Custom-element event names (wa-hover, wa-select, wa-clear) and tag selectors
 * (DOM.select('wa-input')) are valid: SYG110 / SYG126 / the strict lane don't flag the
 * canonical tag + class form or the controls form (controls({ Rating: 'wa-rating' })).
 * The usual true positives still fire: a class the view never renders (SYG110), a control
 * listened to but never rendered (SYG110 by identifier), a control rendered but never
 * listened to (SYG126).
 */
import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { checkFiles } from '../src/index.js'

let tmp
afterEach(() => { if (tmp) fs.rmSync(tmp, { recursive: true, force: true }); tmp = null })

function check(files, opts = {}) {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sygnal-check-wc-'))
  for (const [rel, src] of Object.entries(files)) fs.writeFileSync(path.join(tmp, rel), src)
  return checkFiles(Object.keys(files).map(f => path.join(tmp, f)), { cwd: tmp, ...opts })
}
const codes = (ds) => ds.map(d => `${d.code} ${d.severity}`).sort()

const REVIEW = `
import { set, processForm } from 'sygnal'

export function Review({ state }) {
  return (
    <form className="review">
      <wa-rating className="food" label="Food" value={state.food} attrs={{ name: 'food' }} />
      <wa-input name="email" label="Email" value={state.email} withClear />
      <wa-switch className="notify" checked={state.notify}>Notify me</wa-switch>
      <wa-select className="size" label="Size" value={state.size}>
        <wa-option value="s">Small</wa-option>
        <wa-option value="l">Large</wa-option>
      </wa-select>
      <wa-dropdown className="menu">
        <wa-button slot="trigger" withCaret>Actions</wa-button>
        <wa-dropdown-item value="copy">Copy</wa-dropdown-item>
      </wa-dropdown>
      <p className="out">{state.food}</p>
    </form>
  )
}
Review.initialState = { food: 0, hover: 0, email: '', notify: false, size: 's', action: '', sent: null }
Review.intent = ({ DOM }) => ({
  FOOD: DOM.select('.food').events('change').value(Number),
  HOVER: DOM.select('.food').events('wa-hover').detail(d => d.value),
  EMAIL: DOM.select('wa-input').events('input').value(),
  CLEAR: DOM.select('wa-input').events('wa-clear'),
  NOTIFY: DOM.select('.notify').events('change').checked(),
  SIZE: DOM.select('.size').events('change').value(),
  ACTION: DOM.select('.menu').events('wa-select').detail(d => d.item.value),
  SEND: processForm(DOM.select('.review'), { events: 'submit' }),
})
Review.model = {
  FOOD: set((s, food) => ({ food })),
  HOVER: set((s, hover) => ({ hover })),
  EMAIL: set((s, email) => ({ email })),
  CLEAR: set({ email: '' }),
  NOTIFY: set((s, notify) => ({ notify })),
  SIZE: set((s, size) => ({ size })),
  ACTION: set((s, action) => ({ action })),
  SEND: set((s, sent) => ({ sent })),
}
`

const SURVEY = `
import { controls, set } from 'sygnal'
const { Rating, Email } = controls({ Rating: 'wa-rating', Email: 'wa-input' })

export function Survey({ state }) {
  return (
    <div>
      <Rating label="Service" value={state.service} />
      <Email label="Contact" value={state.contact} />
    </div>
  )
}
Survey.initialState = { service: 0, hover: 0, contact: '' }
Survey.intent = ({ DOM }) => ({
  SERVICE: DOM.select(Rating).events('change').value(Number),
  HOVER: DOM.select(Rating).events('wa-hover').detail(d => d.value),
  CONTACT: DOM.input(Email).value(),
  CLEARED: DOM['wa-clear'](Email),
})
Survey.model = {
  SERVICE: set((s, service) => ({ service })),
  HOVER: set((s, hover) => ({ hover })),
  CONTACT: set((s, contact) => ({ contact })),
  CLEARED: set({ contact: '' }),
}
`

describe('web components (PLAN-5 0-S6)', () => {
  it('canonical tags + class/tag selectors with custom-element events: no diagnostics, strict included', () => {
    expect(codes(check({ 'Review.jsx': REVIEW }))).toEqual([])
    expect(codes(check({ 'Review.jsx': REVIEW }, { strict: true }))).toEqual([])
  })

  it('controls made from custom-element tags, listened to by identifier: no diagnostics, strict included', () => {
    expect(codes(check({ 'Survey.jsx': SURVEY }))).toEqual([])
    expect(codes(check({ 'Survey.jsx': SURVEY }, { strict: true }))).toEqual([])
  })

  it('still reports a class the view never renders (SYG110) on a custom-element event', () => {
    const ds = check({ 'Review.jsx': REVIEW.replace(`DOM.select('.food').events('wa-hover')`, `DOM.select('.fod').events('wa-hover')`) })
    expect(codes(ds)).toEqual(['SYG110 warn'])
    expect(ds[0].message).toContain(`'.fod'`)
    expect(ds[0].fix).toContain(`.food`)
  })

  it('still reports a control rendered but never listened to (SYG126) and one listened to but never rendered (SYG110)', () => {
    const unlistened = check({ 'Survey.jsx': SURVEY.replace(/\n {2}SERVICE: .*\n {2}HOVER: .*\n/, '\n') })
    expect(unlistened.filter(d => d.code === 'SYG126').map(d => d.data.control)).toEqual(['Rating'])
    const unrendered = check({ 'Survey.jsx': SURVEY.replace('<Rating label="Service" value={state.service} />', '') })
    expect(unrendered.filter(d => d.code === 'SYG110').map(d => d.data.control)).toEqual(['Rating', 'Rating'])
  })
})
