/**
 * D49: a present-but-nullish `value` writes '' (and a nullish `checked` writes
 * false) on every render, so the field stays controlled. Only an absent prop
 * (or value={undefined}, which the pragma drops) leaves it uncontrolled.
 * SYG111 reports nullish values like any other controlled value.
 */
import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { checkFiles } from '../src/index.js'

let tmp
afterEach(() => { if (tmp) fs.rmSync(tmp, { recursive: true, force: true }); tmp = null })

function syg111(src) {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sygnal-check-d49-'))
  const file = path.join(tmp, 'C.jsx')
  fs.writeFileSync(file, src)
  return checkFiles([file], { cwd: tmp }).filter(d => d.code === 'SYG111')
}

const component = (field, intent) => `
export function C({ state }) {
  return <div>${field}<button className="tick">{state.n}</button></div>
}
C.initialState = { n: 0, x: null, on: null }
C.intent = ({ DOM }) => ({ TICK: DOM.click('.tick')${intent ? `, ${intent}` : ''} })
C.model = { TICK: (s) => ({ ...s, n: s.n + 1 }), SET: (s) => s }
`

describe('D49: SYG111 and nullish value/checked', () => {
  it('reports <input value={null}> without an input listener', () => {
    const d = syg111(component('<input className="f" value={null} />'))
    expect(d).toHaveLength(1)
    expect(d[0].message).toContain('literal value={null}')
    expect(d[0].message).toContain('clears the typed text')
    expect(d[0].fix).toContain("DOM.input('.f')")
    expect(d[0].data).toMatchObject({ element: 'input', prop: 'value', literal: true })
  })

  it('reports <textarea value={null}> too', () => {
    expect(syg111(component('<textarea className="f" value={null} />'))).toHaveLength(1)
  })

  it('reports a checkbox with checked={null}', () => {
    const d = syg111(component('<input type="checkbox" className="f" checked={null} />'))
    expect(d).toHaveLength(1)
    expect(d[0].message).toContain('literal checked={null}')
    expect(d[0].message).toContain('unchecks it')
    expect(d[0].fix).toContain("DOM.change('.f')")
  })

  it('reports value={x ?? null} as a bound value', () => {
    const d = syg111(component('<input className="f" value={state.x ?? null} />'))
    expect(d).toHaveLength(1)
    expect(d[0].message).toContain('value={…} bound to state')
    expect(d[0].data.literal).toBeUndefined()
  })

  it('reports checked={state.on ?? null}', () => {
    expect(syg111(component('<input type="checkbox" className="f" checked={state.on ?? null} />'))).toHaveLength(1)
  })

  it('stays quiet with a listener', () => {
    expect(syg111(component('<input className="f" value={null} />', "SET: DOM.input('.f').value()"))).toHaveLength(0)
    expect(syg111(component('<input className="f" value={state.x ?? null} />', "SET: DOM.input('.f').value()"))).toHaveLength(0)
    expect(syg111(component('<input type="checkbox" className="f" checked={null} />', "SET: DOM.change('.f')"))).toHaveLength(0)
  })

  it('stays quiet for an absent prop or value={undefined}', () => {
    expect(syg111(component('<input className="f" />'))).toHaveLength(0)
    expect(syg111(component('<input className="f" value={undefined} />'))).toHaveLength(0)
    expect(syg111(component('<input type="checkbox" className="f" checked={undefined} />'))).toHaveLength(0)
  })

  it('stays quiet for a readOnly or disabled field with value={null}', () => {
    expect(syg111(component('<input className="f" readOnly value={null} />'))).toHaveLength(0)
    expect(syg111(component('<input className="f" disabled value={null} />'))).toHaveLength(0)
  })
})
