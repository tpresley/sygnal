/**
 * G-033: SYG111 reports a literal <select value="..."> with no change listener.
 * The runtime controls a select's value like any other field: every re-render
 * puts the selection back to the literal.
 */
import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { checkFiles } from '../src/index.js'

let tmp
afterEach(() => { if (tmp) fs.rmSync(tmp, { recursive: true, force: true }); tmp = null })

function syg111(src) {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sygnal-check-g033-'))
  const file = path.join(tmp, 'C.jsx')
  fs.writeFileSync(file, src)
  return checkFiles([file], { cwd: tmp }).filter(d => d.code === 'SYG111')
}

const component = (select, intent) => `
export function C({ state }) {
  return <div>${select}<button className="tick">{state.n}</button></div>
}
C.initialState = { n: 0 }
C.intent = ({ DOM }) => ({ TICK: DOM.click('.tick')${intent ? `, ${intent}` : ''} })
C.model = { TICK: (s) => ({ ...s, n: s.n + 1 }), PICK: (s) => s }
`

describe('G-033: SYG111 and a literal <select value>', () => {
  it('reports <select value="a"> without a change listener', () => {
    const d = syg111(component('<select className="pick" value="a"><option value="a">A</option><option value="b">B</option></select>'))
    expect(d).toHaveLength(1)
    expect(d[0].message).toContain('literal value="a"')
    expect(d[0].fix).toContain("DOM.change('.pick')")
    expect(d[0].data).toMatchObject({ element: 'select', prop: 'value', literal: true })
  })

  it('reports value={"a"} too', () => {
    expect(syg111(component('<select className="pick" value={"a"}><option value="a">A</option></select>'))).toHaveLength(1)
  })

  it('stays quiet with a change listener', () => {
    expect(syg111(component('<select className="pick" value="a"><option value="a">A</option></select>', "PICK: DOM.change('.pick')"))).toHaveLength(0)
  })

  it('reports value={null} (D49: still controlled) but stays quiet for value={undefined} and a disabled select', () => {
    expect(syg111(component('<select className="pick" value={null}><option value="a">A</option></select>'))).toHaveLength(1)
    expect(syg111(component('<select className="pick" value={undefined}><option value="a">A</option></select>'))).toHaveLength(0)
    expect(syg111(component('<select className="pick" disabled value="a"><option value="a">A</option></select>'))).toHaveLength(0)
  })
})
