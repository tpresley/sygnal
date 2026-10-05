/**
 * PLAN-5 V-1: <VirtualCollection> is a Collection to the static checker: its rows are isolated
 * items (a parent selector that only matches a row is SYG104), its className is the parent's
 * element, its `from` is checked (SYG401), and the canonical example (rows + scrollToIndex /
 * scrollToId element commands) is clean, strict and a11y included.
 */
import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { checkFiles } from '../src/index.js'
import { getExplanation } from '../src/explain.js'

let tmp
afterEach(() => { if (tmp) fs.rmSync(tmp, { recursive: true, force: true }); tmp = null })

function check(files, opts = {}) {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sygnal-check-v1-'))
  for (const [rel, src] of Object.entries(files)) {
    const p = path.join(tmp, rel)
    fs.mkdirSync(path.dirname(p), { recursive: true })
    fs.writeFileSync(p, src)
  }
  const sources = Object.keys(files).filter(f => /\.[jt]sx?$/.test(f)).map(f => path.join(tmp, f))
  return checkFiles(sources, { cwd: tmp, ...opts })
}
const codes = (diags) => diags.map(d => `${d.code} ${d.file}:${d.line}`)

const ROW = `export function Row({ state }) {
  return (
    <div className="row">
      <span className="label">{state.label}</span>
      <button className="star">{state.starred ? 'Unstar' : 'Star'}</button>
    </div>
  )
}
Row.intent = ({ DOM }) => ({ STAR: DOM.click('.star') })
Row.model = { STAR: (state) => ({ ...state, starred: !state.starred }) }
`
const LIST = (intent = '', extraModel = '', from = 'rows') => `import { VirtualCollection } from 'sygnal'
import { Row } from './Row.jsx'
export function List({ state }) {
  return (
    <div>
      <button className="jump">Jump to row 9,000</button>
      <button className="find">Find</button>
      <VirtualCollection of={Row} from="${from}" className="rows" estimateSize={32} aria-label="Rows" />
    </div>
  )
}
List.initialState = { rows: [], title: '' }
List.intent = ({ DOM }) => ({
  JUMP: DOM.click('.jump').mapTo(8999),
  FIND: DOM.click('.find').mapTo(42),${intent}
})
List.model = {
  JUMP: { ELEMENT: (state, index) => ({ scrollToIndex: '.rows', index, align: 'start' }) },
  FIND: { ELEMENT: (state, id) => ({ scrollToId: '.rows', id, align: 'center' }) },${extraModel}
}
`

describe('V-1: VirtualCollection in sygnal-check', () => {
  it('the canonical example is clean (strict and a11y on)', () => {
    expect(codes(check({ 'src/Row.jsx': ROW, 'src/List.jsx': LIST() }, { strict: true, a11y: 'error' }))).toEqual([])
  })

  it('its rows are isolated items: a parent selector matching only a row is SYG104', () => {
    const d = check({ 'src/Row.jsx': ROW, 'src/List.jsx': LIST(`\n  STAR_ALL: DOM.click('.star'),`, `\n  STAR_ALL: (state) => state,`) })
    expect(d.filter(x => x.code === 'SYG104').length).toBe(1)
  })

  it('its className is the parent\'s element (a selector on it is fine)', () => {
    const d = check({ 'src/Row.jsx': ROW, 'src/List.jsx': LIST(`\n  WHEEL: DOM.select('.rows').events('wheel'),`, `\n  WHEEL: (state) => state,`) })
    expect(d.filter(x => /SYG10[34]/.test(x.code))).toEqual([])
  })

  it('a `from` that is not an array in initialState: SYG401', () => {
    const d = check({ 'src/Row.jsx': ROW, 'src/List.jsx': LIST('', '', 'title') })
    expect(d.filter(x => x.code === 'SYG401').length).toBe(1)
  })

  it('SYG430–434 are explained (dev entry)', () => {
    for (const c of ['SYG430', 'SYG431', 'SYG432', 'SYG433', 'SYG434']) {
      const e = getExplanation(c)
      expect(e.title, c).toMatch(/VirtualCollection/)
      expect(e.reportedBy).toEqual(['dev-entry'])
    }
  })
})
