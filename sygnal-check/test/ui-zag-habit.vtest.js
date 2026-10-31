// UI sweep round 2 (F-1, dev-plans/research/ui-sweep/zag.md): SYG141 reports a native 'change' /
// 'input' listener on a selector that resolves only to a first-party Zag part (Menu / Select /
// Combobox), with the part's own event as the suggestion and the rename as a fix.
import { it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { checkFiles } from '../src/index.js'

let tmp
afterEach(() => { if (tmp) fs.rmSync(tmp, { recursive: true, force: true }); tmp = null })
function check(files) {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sygnal-check-zag-habit-'))
  for (const [rel, src] of Object.entries(files)) fs.writeFileSync(path.join(tmp, rel), src)
  return checkFiles(Object.keys(files).map(f => path.join(tmp, f)), { cwd: tmp })
}
const app = (intent, extra = '') => ({ 'App.jsx': `
import { Menu } from 'sygnal/ui/menu'
import { Select } from 'sygnal/ui/select'
import { Combobox } from 'sygnal/ui/combobox'
export function App({ state }) {
  return <form>
    <Select className="size" label="Size" items={['s']} value={state.v} name="size" />
    <Combobox className="city" label="City" items={['x']} />
    <Menu className="more" label="More" items={['a']} />
    <input className="note" name="note" />${extra}
  </form>
}
App.initialState = { v: null }
App.intent = ({ DOM }) => (${intent})
App.model = { A: (s) => s, B: (s) => s, C: (s) => s, D: (s) => s }
` })

it("SYG141: events('change') / events('input') on a Select, a Combobox, a Menu", () => {
  const ds = check(app(`{ A: DOM.select('.size').events('change').detail(), B: DOM.select('.city').events('input').detail(), C: DOM.select('.more').events('change'), D: DOM.select('.note').events('input') }`))
  const w = ds.filter(d => d.code === 'SYG141')
  expect(w).toHaveLength(3)
  const by = (s) => w.find(d => d.data.selector === s)
  expect(by('.size').message).toMatch(/listens for the native 'change' on '\.size' \(Select\): the part reports its value with 'value-change'.*did you mean 'value-change'\?/)
  expect(by('.city').message).toMatch(/native 'input' on '\.city' \(Combobox\).*'value-change'/)
  expect(by('.more').message).toMatch(/the picked item with 'select'/)
  expect(by('.size').fixes?.[0]?.edits?.[0]?.text ?? by('.size').fixes?.[0]?.edit?.text).toBe("'value-change'")
})

it('silent for the declared events, and when a plain element shares the class', () => {
  const ds = check(app(`{ A: DOM.select('.size').events('value-change').detail(), B: DOM.select('.city').events('change') }`, `\n    <input className="city" />`))
  expect(ds.filter(d => d.code === 'SYG141')).toEqual([])
})
