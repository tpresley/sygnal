/**
 * D199 (from spike 0-S2): SYG111 accepts a parent's input listener around a child's fields.
 * Input events bubble out of a child component (a Collection item) to the elements its parent
 * rendered around it (G-145), so a field is listened to when, at every place the component is
 * rendered, the parent listens for input on an element around that place.
 */
import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { checkFiles } from '../src/index.js'

let tmp
afterEach(() => { if (tmp) fs.rmSync(tmp, { recursive: true, force: true }); tmp = null })

function syg111(src) {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sygnal-check-syg111-parent-'))
  const file = path.join(tmp, 'C.jsx')
  fs.writeFileSync(file, src)
  return checkFiles([file], { cwd: tmp }).filter(d => d.code === 'SYG111')
}

const ROW = `import { Collection } from 'sygnal'
export function Row({ state }) {
  return <li><input className="street" name="street" value={state.street} /><button className="pick">Pick</button></li>
}
Row.intent = ({ DOM }) => ({ PICK: DOM.click('.pick') })
Row.model = { PICK: (s) => s }
`

describe('SYG111: a parent listener around the child', () => {
  it("a Collection item's field, with the parent listening on the <form> around the Collection: no SYG111", () => {
    const src = ROW + `
export function Address({ state }) {
  return <form className="addr"><ul><Collection of={Row} from="rows" /></ul></form>
}
Address.initialState = { rows: [] }
Address.intent = ({ DOM }) => ({ EDIT: DOM.select('.addr').events('input') })
Address.model = { EDIT: (s) => s }
`
    expect(syg111(src)).toEqual([])
  })

  it('a child rendered by tag inside the listened element: no SYG111', () => {
    const src = ROW + `
export function Address({ state }) {
  return <form className="addr"><Row state="row" /></form>
}
Address.initialState = { row: { street: '' } }
Address.intent = ({ DOM }) => ({ EDIT: DOM.input('.addr') })
Address.model = { EDIT: (s) => s }
`
    expect(syg111(src)).toEqual([])
  })

  it('a parent listening for a non-input event (click) does not count', () => {
    const src = ROW + `
export function Address({ state }) {
  return <form className="addr"><ul><Collection of={Row} from="rows" /></ul></form>
}
Address.initialState = { rows: [] }
Address.intent = ({ DOM }) => ({ EDIT: DOM.click('.addr') })
Address.model = { EDIT: (s) => s }
`
    expect(syg111(src)).toHaveLength(1)
  })

  it('one place without a listener around it: still SYG111', () => {
    const src = ROW + `
export function Address({ state }) {
  return <div><form className="addr"><Row state="a" /></form><Row state="b" /></div>
}
Address.initialState = { a: { street: '' }, b: { street: '' } }
Address.intent = ({ DOM }) => ({ EDIT: DOM.input('.addr') })
Address.model = { EDIT: (s) => s }
`
    expect(syg111(src)).toHaveLength(1)
  })

  it('a listener on an element that is not around the child does not count', () => {
    const src = ROW + `
export function Address({ state }) {
  return <div><form className="addr"><input className="name" value={state.name} /></form><ul><Collection of={Row} from="rows" /></ul></div>
}
Address.initialState = { rows: [], name: '' }
Address.intent = ({ DOM }) => ({ EDIT: DOM.input('.addr') })
Address.model = { EDIT: (s) => s }
`
    expect(syg111(src).map(d => d.component)).toEqual(['Row'])
  })
})
