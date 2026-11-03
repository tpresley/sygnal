/**
 * Wizard spike type tests (dev-plans/research/wizard): wizard() and <Outlet>. Compiled by
 * `npm run test:types`; never executed.
 */
import { wizard, Outlet } from 'sygnal'
import type { WizardState, WizardCalculated, Route } from 'sygnal'

declare const Source: (p: any) => any
declare const Review: (p: any) => any
type Draft = { title: string }
type Host = { session: string; route: Route }

export const flow = wizard<Draft, Host>({
  steps: {
    source: { label: 'Source', valid: (s) => s.draft.title !== '', visit: { busy: false } },
    review: { when: (s) => !!s.draft.title },
  },
  draft: (state) => ({ title: state.session }),
  key: (state) => state.session,
  dirty: (w) => w.draft.title !== '',
  next: '.next', back: '.back', finish: 'CREATE', confirm: '.leave-dialog',
  url: { route: 'step', param: 'step', key: 'session' },
})
// @ts-expect-error steps are required
export const bad = wizard({})
// @ts-expect-error a draft is a Draft
export const bad2 = wizard<Draft>({ steps: {}, draft: { name: 1 } })

declare const w: WizardState<Draft> & WizardCalculated
export const label: string = w.steps[0].label
export const st: 'current' | 'done' | 'visited' | 'upcoming' | 'blocked' | 'skipped' = w.steps[0].status
export const title: string = w.draft.title

declare const route: Route
export const a = <Outlet of={{ source: Source, review: Review }} from="wizard" />
export const b = <Outlet of={{ home: Source }} route={route} query={['session']} focus={false} />
export const c = <Outlet of={{ x: Source }} current="x" identity={3} />

// Sift stress test item 8: typed step slices (LOCAL), and a step component whose initialState
// doesn't carry the draft
import type { WizardStepComp } from 'sygnal'
type DefineState = { words: string; busy: boolean }
type ReviewState = { creating: boolean }
export const typed = wizard<Draft, Host, { define: DefineState; review: ReviewState }>({
  steps: {
    define: { valid: (s) => s.words !== '' && s.draft.title !== '', visit: { busy: false } },
    review: { visit: { creating: false } },
  },
  dirty: (w, step) => step === 'define' && !!w.local.define?.words,
})
export const typed2 = wizard<Draft, Host, { define: DefineState }>({
  // @ts-expect-error a step LOCAL doesn't name
  steps: { define: {}, other: {} },
})
export const typed3 = wizard<Draft, Host, { define: DefineState }>({
  // @ts-expect-error visit fields are the step's own
  steps: { define: { visit: { nope: 1 } } },
})
declare const tw: WizardState<Draft, { define: DefineState }>
export const words: string | undefined = tw.local.define?.words
export const Define: WizardStepComp<DefineState, Draft> = ({ state }) => <p>{state.words}{state.draft.title}</p>
Define.initialState = { words: '', busy: false }
// @ts-expect-error initialState is the step's own slice
Define.initialState = { words: '', busy: false, draft: { title: '' }, extra: 1 }
