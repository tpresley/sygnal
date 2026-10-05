/**
 * PLAN-5 2-T (D211): SYG722, a Zag UI part (<Menu>, <Select>, <Combobox> from sygnal/ui/menu,
 * sygnal/ui/select, sygnal/ui/combobox) without an accessible name: no `label`, `aria-label` or
 * `aria-labelledby`. A dynamic value or a spread counts as named; the same names imported from
 * elsewhere are not reported.
 */
import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { checkFiles } from '../src/index.js'

let tmp
afterEach(() => { if (tmp) fs.rmSync(tmp, { recursive: true, force: true }); tmp = null })
function check(src, opts = {}) {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sygnal-check-syg722-'))
  fs.writeFileSync(path.join(tmp, 'View.jsx'), src)
  return checkFiles([path.join(tmp, 'View.jsx')], { cwd: tmp, ...opts })
}
const only = (ds) => ds.filter(d => d.code === 'SYG722')
const IMPORTS = `import { Menu } from 'sygnal/ui/menu'
import { Select } from 'sygnal/ui/select'
import { Combobox } from 'sygnal/ui/combobox'
`

describe('SYG722', () => {
  it('each part without label / aria-label / aria-labelledby warns, naming the part', () => {
    const ds = only(check(`${IMPORTS}
export function V({ state }) {
  return <div>
    <Menu className="m" items={['a']} />
    <Select className="s" items={['a']} value={state.s} />
    <Combobox className="c" items={['a']} placeholder="Type" />
  </div>
}`))
    expect(ds.map(d => d.severity)).toEqual(['warn', 'warn', 'warn'])
    expect(ds.map(d => d.message)).toEqual([
      expect.stringMatching(/<Menu> \(sygnal\/ui\/menu\) has no accessible name/),
      expect.stringMatching(/<Select> \(sygnal\/ui\/select\) has no accessible name/),
      expect.stringMatching(/<Combobox> \(sygnal\/ui\/combobox\) has no accessible name/),
    ])
    expect(ds[2].fix).toMatch(/label="/)
  })

  it('a label, aria-label, aria-labelledby, a dynamic value or a spread: clean', () => {
    const ds = only(check(`${IMPORTS}
export function V({ state, ...rest }) {
  return <div>
    <h2 id="t">Trip</h2>
    <Menu className="m" label="Actions" items={['a']} />
    <Menu className="m2" label={state.title} items={['a']} />
    <Select className="s" aria-label="Size" items={['a']} />
    <Combobox className="c" aria-labelledby="t" items={['a']} />
    <Combobox className="d" {...rest} items={['a']} />
  </div>
}`))
    expect(ds).toEqual([])
  })

  it('an empty label is no name; a Menu imported from elsewhere is not a Zag part', () => {
    const ds = only(check(`import { Select } from 'sygnal/ui/select'
import { Menu } from './my-menu.js'
export function V() {
  return <div><Select className="s" label="" items={['a']} /><Menu items={['a']} /></div>
}`))
    expect(ds.map(d => d.message)).toEqual([expect.stringMatching(/<Select>/)])
  })

  it('--a11y=error raises it to an error', () => {
    expect(only(check(`${IMPORTS}\nexport const V = () => <Combobox items={['a']} />`, { a11y: 'error' })).map(d => d.severity)).toEqual(['error'])
  })
})
