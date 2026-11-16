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

  it('a step that moves the flow with a PARENT message is read (the wizard reads it): no SYG171', () => {
    const src = FLOW().replace(`function Source({ state }) {
  return <div><h2>Source</h2><p>{state.draft.title}</p></div>
}`, `function Source({ state }) {
  return <div><h2>Source</h2><p>{state.draft.title}</p><button type="button" className="done">Done</button></div>
}
Source.intent = ({ DOM }) => ({ DONE: DOM.click('.done') })
Source.model = { DONE: { PARENT: () => ({ wizard: 'NEXT' }) } }`)
    expect(codes(check({ 'NewThing.jsx': src }, { strict: true }))).toEqual([])
  })

  it('SYG456 / SYG457 follow a same-module const of={STEPS}', () => {
    const src = FLOW()
      .replace('<Outlet of={{ source: Source, review: Review }} from="wizard" />', '<Outlet of={STEPS} from="wizard" />')
      .replace('export function NewThing', 'const STEPS = { source: Source, reveiw: Review }\n\nexport function NewThing')
    const d = check({ 'NewThing.jsx': src })
    expect(codes(d)).toEqual(['SYG456 error', 'SYG457 warn'])
    expect(d.find(x => x.code === 'SYG457').message).toContain("did you mean 'review'")
  })

  describe("prototype options: guard, proceed, host, slice, a step's back / next", () => {
    const PROTO = (steps = "source: { label: 'Source', guard: 'step', host: ['created'], slice: 'shared', valid: (s) => !!s.draft.title, next: (s) => (s.phase ? null : { ...s, phase: 1 }), back: (s) => (s.phase ? { ...s, phase: 0 } : null) }, review: { label: 'Review', slice: 'shared' }", opts = "guard: 'flow', host: ['created'], rekey: () => ({ created: '' }), proceed: '.save-go', ") =>
      FLOW({ opts: opts + "next: '.next', back: '.back', reset: '.start-over', goto: '.goto', finish: 'CREATE'" })
        .replace("steps: { source: { label: 'Source', valid: (s) => !!s.draft.title }, review: { label: 'Review' } }", `steps: { ${steps} }`)
        .replace('<button type="button" className="start-over">', '<button type="button" className="save-go">Save and continue</button>\n      <button type="button" className="start-over">')

    it('the options are known: clean (strict), the proceed selector is listened to', () => {
      expect(codes(check({ 'NewThing.jsx': PROTO() }, { strict: true }))).toEqual([])
    })

    it("a step's { wizard: 'PROCEED' } PARENT message is read", () => {
      const src = PROTO().replace(`function Source({ state }) {
  return <div><h2>Source</h2><p>{state.draft.title}</p></div>
}`, `function Source({ state }) {
  return <div><h2>Source</h2><p>{state.draft.title}</p><button type="button" className="go">Continue</button></div>
}
Source.intent = ({ DOM }) => ({ GO: DOM.click('.go') })
Source.model = { GO: { PARENT: () => ({ wizard: 'PROCEED' }) } }`)
      expect(codes(check({ 'NewThing.jsx': src }, { strict: true }))).toEqual([])
    })

    it('SYG127: a guard value the wizard does not read (on a step and on the wizard)', () => {
      const d = check({ 'NewThing.jsx': PROTO("source: { label: 'Source', guard: 'stp' }, review: { label: 'Review' }", "guard: 'steps', ") })
      expect(codes(d)).toEqual(['SYG127 error', 'SYG127 error'])
      expect(d.map(x => x.data.suggestion)).toEqual(['step', 'step'])
      expect(d.every(x => x.fixes?.length)).toBe(true)
    })

    it("SYG127: a host field that is no key of the host's initialState", () => {
      const d = check({ 'NewThing.jsx': PROTO("source: { label: 'Source', host: ['creatd'] }, review: { label: 'Review' }", "host: ['nope'], ") })
      expect(codes(d)).toEqual(['SYG127 error', 'SYG127 error'])
      expect(d.find(x => x.data.field === 'creatd').message).toContain("did you mean 'created'")
      expect(d.find(x => x.data.field === 'nope').data.reason).toBe('host')
    })

    it("SYG459: a step's next / back reading a host field off its bag", () => {
      const d = check({ 'NewThing.jsx': PROTO("source: { label: 'Source', next: (s, h) => (h.created ? null : { ...s, phase: 1 }), back: (s, { created }) => (created ? s : null) }, review: { label: 'Review' }", '') })
      expect(codes(d)).toEqual(['SYG459 warn', 'SYG459 warn'])
      expect(d.map(x => x.data.option).sort()).toEqual(['steps.source.back', 'steps.source.next'])
    })

    it("SYG127: a step reading or writing a host field it doesn't declare in host", () => {
      const withSource = (body) => PROTO("source: { label: 'Source', valid: (s) => !!s.created }, review: { label: 'Review', host: ['created'], valid: (s) => !!s.created }", '')
        .replace(`function Source({ state }) {
  return <div><h2>Source</h2><p>{state.draft.title}</p></div>
}`, body)
      // a predicate's read
      let d = check({ 'NewThing.jsx': withSource(`function Source({ state }) {
  return <div><h2>Source</h2><p>{state.draft.title}</p></div>
}`) })
      expect(codes(d)).toEqual(['SYG127 error'])
      expect(d[0].data).toMatchObject({ reason: 'host-undeclared', step: 'source', field: 'created', access: 'reads' })
      // a reducer's write (reported once per field, as the write)
      d = check({ 'NewThing.jsx': withSource(`function Source({ state }) {
  return <div><h2>Source</h2><p>{state.draft.title}</p><button type="button" className="mk">Make</button></div>
}
Source.intent = ({ DOM }) => ({ MAKE: DOM.click('.mk') })
Source.model = { MAKE: (s) => ({ ...s, created: 'yes' }) }`) })
      expect(codes(d)).toEqual(['SYG127 error'])
      expect(d[0].data).toMatchObject({ field: 'created', access: 'writes' })
      expect(d[0].message).toContain('never sees it')
      // the view's read
      d = check({ 'NewThing.jsx': PROTO("source: { label: 'Source' }, review: { label: 'Review' }", '').replace('<h2>Source</h2><p>{state.draft.title}</p>', '<h2>Source</h2><p>{state.created}</p>') })
      expect(d.map(x => x.data.access)).toEqual(['reads'])
    })

    // Tune 2026-11-15 (the 7.7 candidate): three forms the rule missed
    it("SYG127: a host field read in a step's calculated field or in a sink other than STATE; rekey returning a field the host doesn't have", () => {
      const base = PROTO("source: { label: 'Source' }, review: { label: 'Review' }", '')
      const SRC = `function Source({ state }) {
  return <div><h2>Source</h2><p>{state.draft.title}</p></div>
}`
      expect(base).toContain(SRC)
      // calculated
      let d = check({ 'NewThing.jsx': base.replace(SRC, SRC + "\nSource.calculated = { tag: (s) => s.created || 'none' }") })
      expect(codes(d)).toEqual(['SYG127 error'])
      expect(d[0].data).toMatchObject({ reason: 'host-undeclared', step: 'source', field: 'created', access: 'reads' })
      expect(d[0].message).toContain("calculated tag")
      // a PARENT sink's read
      d = check({ 'NewThing.jsx': base.replace(SRC, `function Source({ state }) {
  return <div><h2>Source</h2><p>{state.draft.title}</p><button type="button" className="mk">Make</button></div>
}
Source.intent = ({ DOM }) => ({ MAKE: DOM.click('.mk') })
Source.model = { MAKE: { PARENT: (s) => ({ wizard: 'GOTO', step: s.created ? 'review' : 'source' }) } }`) })
      expect(codes(d)).toEqual(['SYG127 error'])
      expect(d[0].data).toMatchObject({ field: 'created', access: 'reads' })
      expect(d[0].message).toContain('MAKE PARENT')
      // rekey: a typo of a host field; a real one is quiet
      d = check({ 'NewThing.jsx': PROTO("source: { label: 'Source' }, review: { label: 'Review' }", "rekey: () => ({ creatd: null }), ") })
      expect(codes(d)).toEqual(['SYG127 error'])
      expect(d[0].data).toMatchObject({ reason: 'rekey', field: 'creatd', suggestion: 'created' })
      expect(codes(check({ 'NewThing.jsx': PROTO("source: { label: 'Source' }, review: { label: 'Review' }", "rekey: (s) => (s.created ? { created: null } : null), ") }))).toEqual([])
    })

    it("no report for a field the step's own initialState has, one the wizard's host names, or the draft", () => {
      const own = PROTO("source: { label: 'Source', valid: (s) => !!s.created && !!s.draft.title }, review: { label: 'Review' }", '')
        .replace('function Review(', "Source.initialState = { created: '' }\nSource.isolatedState = true\nfunction Review(")
      expect(codes(check({ 'NewThing.jsx': own }))).toEqual([])
      const wide = PROTO("source: { label: 'Source', valid: (s) => !!s.created }, review: { label: 'Review' }", "host: ['created'], ")
      expect(codes(check({ 'NewThing.jsx': wide }))).toEqual([])
    })
  })
})
