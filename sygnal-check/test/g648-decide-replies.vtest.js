/**
 * G-648: `decide()` / `decide.openai()` from 'sygnal/ai' pass `ok` / `error` through to the fetch
 * request they build, so the names in their options object are reply actions (no SYG102 for the
 * entries they name; SYG112 for a misspelled one). A `decide` that isn't sygnal/ai's is opaque.
 */
import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { checkFiles } from '../src/index.js'

let tmp
afterEach(() => { if (tmp) fs.rmSync(tmp, { recursive: true, force: true }); tmp = null })

function check(src) {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sygnal-check-g648-'))
  const p = path.join(tmp, 'Ticket.jsx')
  fs.writeFileSync(p, src)
  return checkFiles([p], { cwd: tmp })
}
const by = (diags, code) => diags.filter(d => d.code === code)

const component = (imports, httpValue, extra = '') => `${imports}
const questions = { topic: choice(['billing', 'bug']) }
${extra}
export default function Ticket({ state }) {
  return <p>{state.topic}</p>
}
Ticket.initialState = { text: '', topic: null }
Ticket.model = {
  BOOTSTRAP: { HTTP: ${httpValue} },
  TRIAGED: (state, { answers }) => ({ ...state, topic: answers.topic }),
  TRIAGE_FAILED: (state) => ({ ...state, topic: 'unknown' }),
}
`

describe('G-648: reply actions inside decide()', () => {
  it('decide({ ..., ok, error }) inline: no SYG102', () => {
    const d = check(component(`import { decide, choice } from 'sygnal/ai'`,
      `(state) => decide({ model: 'jev-latest', state: state.text, questions, ok: 'TRIAGED', error: 'TRIAGE_FAILED' })`))
    expect(by(d, 'SYG102')).toEqual([])
  })

  it('through a helper (the task 46 shape), with an alias import', () => {
    const d = check(component(`import { decide as ask, choice } from 'sygnal/ai'`, `triage`,
      `const triage = (state) => ask({ state: state.text, questions, ok: 'TRIAGED', error: 'TRIAGE_FAILED' })`))
    expect(by(d, 'SYG102')).toEqual([])
  })

  it('decide.openai({ ... }) and an options object in a variable', () => {
    const d = check(component(`import { decide, choice } from 'sygnal/ai'`,
      `(state) => decide.openai(OPTS)`,
      `const OPTS = { model: 'gpt-6-luna', questions, ok: 'TRIAGED', error: 'TRIAGE_FAILED' }`))
    expect(by(d, 'SYG102')).toEqual([])
  })

  it('a misspelled reply action inside decide() is SYG112, and the unnamed entry stays SYG102', () => {
    const d = check(component(`import { decide, choice } from 'sygnal/ai'`,
      `(state) => decide({ state: state.text, questions, ok: 'TRIAGED', error: 'TRIAGE_FIALED' })`))
    expect(by(d, 'SYG112').map(x => x.data?.name ?? x.message)).toHaveLength(1)
    expect(by(d, 'SYG102').map(x => x.data.action)).toEqual(['TRIAGE_FAILED'])
  })

  it('a decide() that is not sygnal/ai\'s is not read as a request', () => {
    const d = check(component(`import { choice } from 'sygnal/ai'
import { decide } from './elsewhere.js'`,
      `(state) => decide({ ok: 'TRIAGED', error: 'TRIAGE_FAILED' })`))
    expect(by(d, 'SYG102').map(x => x.data.action).sort()).toEqual(['TRIAGED', 'TRIAGE_FAILED'])
  })

  it('a resources decide({ ..., ok }) names its reply action too', () => {
    const src = `import { decide, choice } from 'sygnal/ai'
const questions = { topic: choice(['billing', 'bug']) }
export default function Ticket({ state }) { return <p>{state.text}</p> }
Ticket.initialState = { text: '' }
Ticket.resources = {
  triage: (state) => state.text && decide({ state: state.text, questions, ok: 'TRIAGED' }),
}
Ticket.model = {
  TRIAGED: (state) => state,
}
`
    expect(by(check(src), 'SYG102')).toEqual([])
  })
})
