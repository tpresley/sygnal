// A `const model` with `satisfies ModelFor<Spec>` reads as the same model: the same findings
// (--strict too) and the same graph as the plain constant and the inline form.
import { describe, it, expect, afterAll } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { check, graph } from '../src/index.js'

const dirs = []
afterAll(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }) })

// one line per construct, so a finding has the same line number in every form
const source = (annotation, tail) => `import type { Comp, IntentSources, ModelFor, ModelActions, ActionsOf } from 'sygnal'
type State = { n: number; note: string | null }
const intent = ({ DOM }: IntentSources<State>) => ({ INC: DOM.click('.inc').mapTo(1), MISSING: DOM.click('.missing') })
type Spec = { state: State; actions: ActionsOf<typeof intent> }
const model = {
  INC: { STATE: (state, n) => { return { ...state, n: state.n + n } }, EFFECT: (_s, _n, next) => { next('NOT_AN_ACTION') } },
  LOAD: { HTTP: (state) => ({ url: '/x/' + state.n, ok: 'LOADED', error: 'NO_ENTRY' }) },
  LOADED: (state, note: string) => ({ ...state, note }),
  TYPO_KEY: (state) => state,
}${annotation}
export const C: Comp<Spec & { actions: ModelActions<typeof model> }> = ({ state }) => <button className="inc">{state.n}</button>
C.intent = intent
${tail}
`
const write = (text) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sygnal-check-satisfies-'))
  dirs.push(dir)
  fs.writeFileSync(path.join(dir, 'c.tsx'), text)
  return dir
}
const findings = (dir, strict) => check(['.'], { cwd: dir, strict }).map(d => `${d.line} ${d.code} ${d.severity} ${d.message}`).sort()
const shape = (dir) => {
  const g = graph(['.'], { cwd: dir, strict: true })
  const strip = (x) => JSON.parse(JSON.stringify(x, (k, v) => (k === 'file' || k === 'cwd' || k === 'root' ? undefined : v)))
  return strip(g)
}

describe('satisfies ModelFor<Spec>', () => {
  const plain = write(source('', 'C.model = model'))
  const satisfied = write(source(' satisfies ModelFor<Spec>', 'C.model = model'))

  it('the checker sees the model: the planted mistakes are found', () => {
    const codes = findings(satisfied, true).map(f => f.split(' ')[1])
    for (const code of ['SYG101', 'SYG102', 'SYG112', 'SYG117']) expect(codes, code).toContain(code)
  })

  it('same findings as the plain constant, with and without --strict', () => {
    expect(findings(plain, true).length).toBeGreaterThan(0)
    expect(findings(satisfied, false)).toEqual(findings(plain, false))
    expect(findings(satisfied, true)).toEqual(findings(plain, true))
  })

  it('same graph as the plain constant', () => {
    expect(shape(satisfied)).toEqual(shape(plain))
  })

  it('the same when the satisfies is on the assignment', () => {
    const direct = write(source('', 'C.model = model satisfies ModelFor<Spec>'))
    expect(findings(direct, true)).toEqual(findings(plain, true))
  })
})
