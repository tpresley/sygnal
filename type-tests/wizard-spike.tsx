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
// N6: the bag's props are unknown (a behavior doesn't know its host's props); the host state is bag.state
export const n6ok = wizard<Draft, Host>({ steps: { a: { when: (_s, { state }) => state.route.name === 'step', label: (_s, b) => String(b.title ?? 'A') } } })
// @ts-expect-error the pre-7.2 form: the 2nd argument was the host state; h.route is an unknown prop now
export const n6bad = wizard<Draft, Host>({ steps: { a: { when: (_s, h) => h.route } } })
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
  dirty: (s, step, { state: h }) => step === 'define' && !!s.draft.title && h.session !== '',
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
export const Define: WizardStepComp<DefineState, { draft: Draft }> = ({ state }) => <p>{state.words}{state.draft.title}</p>
Define.initialState = { words: '', busy: false }
// @ts-expect-error initialState is the step's own slice
Define.initialState = { words: '', busy: false, draft: { title: '' }, extra: 1 }

// the decided API: predicates (step, bag) (7.2; bag.state: the host state), per-step dirty / discard, a label function, draftKey,
// resetTo, PARENT messages, Outlet fallback
import type { WizardMessage } from 'sygnal'
export const decided = wizard<Draft, Host, { define: DefineState; review: ReviewState }, 'flow'>({
  draftKey: 'flow',
  steps: {
    define: {
      label: (s, { state: h }) => s.words ? 'Define' : 'Define for ' + h.session,
      valid: (s, { state: h }) => s.flow.title !== '' && h.session !== '',
      dirty: (s) => !!s.words,
      discard: (s) => ({ words: '', flow: { title: '' } }),
    },
    review: { when: (s) => !s.creating },
  },
  resetTo: (w, { state: h }) => ({ to: 'home', query: { from: String(w.key ?? h.session) } }),
})
export const msgs: WizardMessage[] = [{ wizard: 'NEXT' }, { wizard: 'GOTO', step: 'review' }, { wizard: 'RESET', draft: {} }]
// @ts-expect-error GOTO needs a step
export const badMsg: WizardMessage = { wizard: 'GOTO' }
export const d2 = wizard<Draft, Host, { define: DefineState }, 'flow'>({
  // @ts-expect-error the draft is under draftKey
  steps: { define: { valid: (s) => s.draft.title !== '' } },
})
declare const NotPorted: (p: any) => any
export const f = <Outlet of={{ x: Source }} current="y" identity="y:1" fallback={NotPorted} />

// pass 2 bug C: local holds what a step wrote (Partial); the predicates see the full OWN
// @ts-expect-error a field of local may be missing
export const partialWords: string = tw.local.define!.words
export const fullView = wizard<Draft, Host, { define: DefineState }>({
  steps: { define: { valid: (s) => s.busy === false && s.words.length > 0 } },
})

// pass 3: groups, outcome, dialog copy, the stepper, GOTO with a key, resetTo(previous), Outlet state map
export const p3 = wizard<Draft, Host, { define: DefineState; analyze: {}; describe: {}; created: {} }>({
  steps: {
    define: { dialog: { title: 'Discard what you typed?' } },
    analyze: { group: 'build' },
    describe: { group: 'build', dialog: (s, { state: h }) => ({ title: 'Discard your reply in ' + h.session }) },
    created: { outcome: true },
  },
  groups: { build: { label: 'Build the filter' } },
  dialog: { title: 'Leave?' },
  resetTo: (prev) => ({ to: 'home', query: { from: String(prev.key) } }),
})
declare const w3: WizardState<Draft> & WizardCalculated
export const entrySteps: string[] = w3.stepper[0].steps
export const applying: string = w3.stepper[0].step
export const outcomeName: string | null = w3.outcome
export const rekey: WizardMessage = { wizard: 'GOTO', step: 'describe', key: 'S2' }
export const sm = <Outlet of={{ admin: Source, home: Review }} current="admin" state={{ admin: 'pages.admin' }} />
// @ts-expect-error a state map key names a page
export const smBad = <Outlet of={{ admin: Source }} current="admin" state={{ amdin: 'x' }} />

// pass 3: a step that doesn't read the draft (its own state only; its reducers take and return it);
// a step that reads it under another key
export const Review2: WizardStepComp<ReviewState> = ({ state }) => <p>{String(state.creating)}</p>
Review2.model = { CREATE: (s: ReviewState) => ({ ...s, creating: true }) }
Review2.initialState = { creating: false }
// @ts-expect-error no draft in a step that doesn't read it
export const NoDraft: WizardStepComp<ReviewState> = ({ state }) => <p>{state.draft}</p>
export const Flowed: WizardStepComp<DefineState, { flow: Draft }> = ({ state }) => <p>{state.flow.title}</p>

// Sift pass 3 N3: a step that writes the draft in some reducers and reads none: `{ flow?: Draft }`
import type { IntentSources } from 'sygnal'
export const Writer: WizardStepComp<ReviewState, { flow?: Draft }> = ({ state }) => <p>{String(state.creating)}</p>
Writer.model = {
  START: (s: ReviewState) => ({ ...s, creating: true }),
  CREATED: (s) => ({ ...s, creating: false, flow: { ...s.flow!, title: 'made' } }),
}
Writer.intent = (sources: IntentSources<ReviewState>) => ({ START: sources.DOM.click('.start') })

// Sift pass 3: a DIALOG type for state.wizard.dialog; WizardStepComp<Own, Spec> with no middle undefined
type Copy = { title: string; body?: string }
export const typedDialog = wizard<Draft, Host, { define: DefineState }, 'draft', Copy>({
  steps: { define: { dialog: (s, { state: h }) => ({ title: 'Discard ' + s.words + ' for ' + h.session }) } },
  dialog: { title: 'Leave?' },
})
// @ts-expect-error a dialog copy is a Copy
export const badDialog = wizard<Draft, Host, { define: DefineState }, 'draft', Copy>({ steps: { define: { dialog: { nope: 1 } } } })
declare const wd: WizardCalculated<Copy>
export const dtitle: string | undefined = wd.dialog?.title
type ReviewActions = { START: void }
export const WithSpec: WizardStepComp<ReviewState, { actions: ReviewActions }> = ({ state }) => <p>{String(state.creating)}</p>
WithSpec.model = { START: (s) => ({ ...s, creating: true }) }
// @ts-expect-error no draft with a spec only
export const WithSpecNoDraft: WizardStepComp<ReviewState, { actions: ReviewActions }> = ({ state }) => <p>{state.draft}</p>
export const DraftAndSpec: WizardStepComp<DefineState, { flow: Draft }, { actions: ReviewActions }> = ({ state }) => <p>{state.flow.title}</p>

// 7.2 (the one bag): draft / key / url.from get (hostState, bag); the bag has the host's props, context, uid
export const bagged = wizard<Draft, Host>({
  steps: { source: { valid: (s, { state, uid }) => s.draft.title !== '' && state.session !== uid() } },
  draft: (state, { context }) => ({ title: String(context?.title ?? state.session) }),
  key: (state, bag) => bag.recordId ?? state.session,
  url: { route: 'step', param: 'step', from: (state, { context }) => context?.route ?? state.route },
  // @ts-expect-error the bag's state is the host state
  dirty: (s, step, { state }) => state.nope,
})
