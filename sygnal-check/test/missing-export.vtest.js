/**
 * SYG427 (static): a component imported from a module that doesn't export it (undefined under
 * Vitest, a link error in the browser), used as a JSX tag, in CHILD.select() or as `of=`.
 */
import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { checkFiles } from '../src/index.js'

let tmp
afterEach(() => { if (tmp) fs.rmSync(tmp, { recursive: true, force: true }); tmp = null })

function check(files, scan = Object.keys(files)) {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sygnal-check-427-'))
  for (const [rel, src] of Object.entries(files)) {
    const p = path.join(tmp, rel)
    fs.mkdirSync(path.dirname(p), { recursive: true })
    fs.writeFileSync(p, src)
  }
  return checkFiles(scan.map(f => path.join(tmp, f)), { cwd: tmp }).filter(d => d.code === 'SYG427')
}

const child = (exp = '') => `${exp}function Child() { return <button className="go">Go</button> }
Child.intent = ({ DOM }) => ({ GO: DOM.click('.go') })
Child.model = { GO: { PARENT: () => 'go' } }
`

const parent = (imp = `import { Child } from './child.jsx'`) => `${imp}
export function Parent({ state }) { return <div>{state.show ? <Child /> : null}</div> }
Parent.initialState = { show: false }
Parent.intent = ({ CHILD }) => ({ GOT: CHILD.select(Child) })
Parent.model = { GOT: (state) => state }
`

describe('SYG427 (static)', () => {
  it('reports a component its module does not export (the tag first), as an error', () => {
    const d = check({ 'child.jsx': child(), 'parent.jsx': parent() }, ['parent.jsx'])
    expect(d).toHaveLength(1)
    expect(d[0].severity).toBe('error')
    expect(d[0].message).toMatch(/Child is imported from '\.\/child\.jsx', which has no export named 'Child'/)
    expect(d[0].message).toMatch(/<Child \/> renders nothing/)
    expect(d[0].data).toMatchObject({ imported: 'Child', usedAs: 'tag' })
  })

  it('reports CHILD.select() alone, and a missing default export', () => {
    const selectOnly = parent().replace('{state.show ? <Child /> : null}', 'nothing')
    expect(check({ 'child.jsx': child(), 'parent.jsx': selectOnly })[0].message).toMatch(/CHILD\.select\(Child\) never emits/)
    const d = check({ 'child.jsx': child('export '), 'parent.jsx': parent(`import Child from './child.jsx'`) })
    expect(d[0].message).toMatch(/which has no default export/)
  })

  it('reports a Collection of= component', () => {
    const src = `import { Collection } from 'sygnal'
import { Row } from './row.jsx'
export function List({ state }) { return <ul><Collection of={Row} from="rows" /></ul> }
List.initialState = { rows: [] }
`
    const d = check({ 'row.jsx': 'function Row() { return <li /> }\n', 'list.jsx': src })
    expect(d.map(x => x.data.usedAs)).toEqual(['of'])
  })

  it('nothing when it is exported (declaration, specifier, alias, default, re-export)', () => {
    expect(check({ 'child.jsx': child('export '), 'parent.jsx': parent() })).toEqual([])
    expect(check({ 'child.jsx': child() + 'export { Child }\n', 'parent.jsx': parent() })).toEqual([])
    expect(check({ 'child.jsx': child() + 'export { Child as Kid }\n', 'parent.jsx': parent(`import { Kid as Child } from './child.jsx'`) })).toEqual([])
    expect(check({ 'child.jsx': child() + 'export default Child\n', 'parent.jsx': parent(`import Child from './child.jsx'`) })).toEqual([])
    expect(check({ 'child.jsx': child('export '), 'index.js': `export { Child } from './child.jsx'\n`, 'parent.jsx': parent(`import { Child } from './index.js'`) })).toEqual([])
  })

  it('nothing when the exports cannot be listed (export *, CommonJS) or the import is not relative', () => {
    expect(check({ 'child.jsx': child('export '), 'index.js': `export * from './child.jsx'\n`, 'parent.jsx': parent(`import { Child } from './index.js'`) })).toEqual([])
    expect(check({ 'child.jsx': child() + 'module.exports = { Child }\n', 'parent.jsx': parent() })).toEqual([])
    expect(check({ 'parent.jsx': parent(`import { Child } from 'some-package'`) })).toEqual([])
  })
})
