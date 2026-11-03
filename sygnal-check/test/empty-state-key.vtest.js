/**
 * SYG410 (static): a child component's literal state="" (or an empty path segment) names an empty
 * key, so the child gets no state and doesn't render. --fix removes state="".
 */
import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { checkFiles } from '../src/index.js'
import { applyEdits } from '../src/edits.js'

let tmp
afterEach(() => { if (tmp) fs.rmSync(tmp, { recursive: true, force: true }); tmp = null })

const form = (attr) => `function RangeField({ state }) { return <input value={state.v} /> }
function Card({ children }) { return <div>{children}</div> }
export function Form() { return <form><RangeField${attr} id="r" /><Card><RangeField${attr} id="r2" /></Card></form> }
Form.initialState = { v: 1, x: { v: 2 } }
`
function check(src) {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sygnal-check-syg410-'))
  fs.writeFileSync(path.join(tmp, 'F.jsx'), src)
  return { src, found: checkFiles([path.join(tmp, 'F.jsx')], { cwd: tmp }).filter(d => d.code === 'SYG410') }
}

describe('SYG410 (static): an empty state key', () => {
  it('state="" is reported on each child, also one passed as children, with a fix that removes it', () => {
    const { src, found } = check(form(' state=""'))
    expect(found).toHaveLength(2)
    expect(found[0].severity).toBe('error')
    expect(found[0].message).toBe("<RangeField state=\"\"> names an empty key, so RangeField gets no state and doesn't render")
    expect(found[0].fix).toMatch(/leave state out to share the parent's state/)
    const edits = found.flatMap(d => d.fixes[0].edits)
    expect(applyEdits(src, edits)).toBe(form(''))
  })

  it("state={''} and an empty path segment are reported", () => {
    expect(check(form(" state={''}")).found).toHaveLength(2)
    for (const p of ['x.', '.x', 'a..b']) {
      const { found } = check(form(` state="${p}"`))
      expect(found[0]?.message).toMatch(/has an empty path segment/)
      expect(found[0].fixes).toBeUndefined()
    }
  })

  it('a key, a path, a position and no state prop are not reported', () => {
    for (const a of [' state="x"', ' state="x.v"', ' state="list[0]"', '']) expect(check(form(a)).found).toEqual([])
  })
})
