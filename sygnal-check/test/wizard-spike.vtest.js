/**
 * Wizard spike (dev-plans/research/wizard): sygnal-check knows the first-party `wizard` behavior
 * (FIRST_PARTY.wizard: its slice keys, calculated fields, actions, options, the selectors it
 * listens to, `finish` as a dispatched host action) and <Outlet of={{ name: Page }}> as rendering
 * its pages. The recipe is clean under --strict and a11y; an option typo is SYG127.
 */
import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { checkFiles } from '../src/index.js'

let tmp
afterEach(() => { if (tmp) fs.rmSync(tmp, { recursive: true, force: true }); tmp = null })

function check(files, opts = {}) {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sygnal-check-wizard-'))
  for (const [rel, src] of Object.entries(files)) {
    const p = path.join(tmp, rel)
    fs.mkdirSync(path.dirname(p), { recursive: true })
    fs.writeFileSync(p, src)
  }
  return checkFiles(Object.keys(files).map(f => path.join(tmp, f)), { cwd: tmp, ...opts })
}
const codes = (diags) => diags.map(d => `${d.code} ${d.severity}`).sort()

const FLOW = ({ opts = "next: '.next', back: '.back', reset: '.start-over', goto: '.goto', finish: 'CREATE'" } = {}) => `import { wizard, Outlet } from 'sygnal'

function Source({ state }) {
  return <div><h2>Source</h2><p>{state.draft.title}</p></div>
}
function Review({ state }) {
  return <div><h2>Review</h2><p>{state.draft.title}</p></div>
}

export function NewThing({ state }) {
  const w = state.wizard
  return (
    <section>
      <ol aria-label="Progress">
        {w.steps.map((s) => (
          <li aria-current={s.current ? 'step' : undefined}>
            <button type="button" className="goto" data-step={s.name} disabled={!s.reachable}>{s.label}</button>
          </li>
        ))}
      </ol>
      <Outlet of={{ source: Source, review: Review }} from="wizard" />
      <button type="button" className="back" disabled={!w.canBack}>Back</button>
      <button type="button" className="next" disabled={!w.canNext}>Next</button>
      <button type="button" className="start-over">Start over</button>
      <p>{state.created}</p>
    </section>
  )
}
NewThing.initialState = { created: '' }
NewThing.uses = {
  wizard: wizard({
    steps: { source: { label: 'Source', valid: (s) => !!s.draft.title }, review: { label: 'Review' } },
    draft: { title: '' },
    ${opts},
  }),
}
NewThing.model = {
  CREATE: (state, draft) => ({ ...state, created: draft.title }),
}
`

describe('wizard spike: sygnal-check', () => {
  it('the recipe is clean (strict, a11y)', () => {
    expect(codes(check({ 'NewThing.jsx': FLOW() }, { strict: true }))).toEqual([])
  })

  it('an unknown option is SYG127', () => {
    const d = check({ 'NewThing.jsx': FLOW({ opts: "nxt: '.next', next: '.next', back: '.back', reset: '.start-over', goto: '.goto', finish: 'CREATE'" }) })
    expect(codes(d)).toEqual(['SYG127 error'])
  })

  it('SYG455: <Outlet from> naming no uses key (did you mean), or a behavior that is not a wizard', () => {
    const d = check({ 'NewThing.jsx': FLOW().replace('from="wizard"', 'from="wizrd"') })
    expect(codes(d)).toEqual(['SYG455 error'])
    expect(d[0].message).toContain("did you mean 'wizard'")
  })

  it('SYG456: a step with no component in of; SYG457: an of key that is no step', () => {
    const d = check({ 'NewThing.jsx': FLOW().replace('of={{ source: Source, review: Review }}', 'of={{ source: Source, reveiw: Review }}') })
    expect(codes(d)).toEqual(['SYG456 error', 'SYG457 warn'])
    expect(d.find(x => x.code === 'SYG457').message).toContain("did you mean 'review'")
  })
})
