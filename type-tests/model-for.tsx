// A model written apart from its component.
// `const model = { ... } satisfies ModelFor<Spec>` contextually types the reducers; `ModelActions<typeof model>`
// adds the actions only the model names (replies, next()) to the component.
import { ABORT, type ActionsOf, type Comp, type FetchFailure, type IntentSources, type ModelActions, type ModelFor, type RootComp } from 'sygnal'

type State = { count: number; name: string; note: string | null; rows: { id: string }[] }
type Payload = { id: string; n: number }
type Ctx = { csrf: string | null; viewer: { id: string } | null }

const intent = ({ DOM }: IntentSources<State>) => ({
  INC: DOM.click('.inc').mapTo(1),
  NAME: DOM.input('.name').value(),
  PICK: DOM.click('.row').map((): Payload => ({ id: 'a', n: 1 })),
})

type Spec = { state: State; props: { label: string }; context: Ctx; actions: ActionsOf<typeof intent> }

// --- positive: nothing annotated, everything typed -------------------------------------------------------
const model = {
  INC: (state, n, next, { previousState, context, label, now }) => {
    const a: number = n, b: string | null = context.csrf, c: string = label, d: number = now(), e: number = previousState.count
    next('NAME', 'x')
    next('DONE')              // an action only this model names
    next('SAVED', { any: 1 }, 10)
    void [a, b, c, d, e]
    return { ...state, count: state.count + 1 }
  },
  NAME: { STATE: (state, name) => ({ ...state, name: name.toUpperCase() }), LOG: (_s, name) => name, EFFECT: (_s, name, next) => { next('DONE', name) } },
  PICK: {
    STATE: (state, { id }) => ({ ...state, note: id }),
    HTTP: (_s, { n }, _next, { context }) => (context.csrf && n > 0 ? '/x' : ABORT),   // a driver sink: the action's data too
  },
  // actions Spec doesn't name: the data is `unknown` until annotated
  DONE: (state, d) => {
    // @ts-expect-error — not annotated: unknown
    d.nope
    return state
  },
  SAVED: { STATE: (state, reply: { id: string }) => ({ ...state, note: reply.id }), EFFECT: (_s, reply: { id: string }) => { void reply.id } },
  FAILED: (state, failure: FetchFailure) => ({ ...state, note: String(failure.status) }),
  UNION: { STATE: (state, v: string | null) => ({ ...state, note: v }), PARENT: (_s, v: string | null) => v },
  BOOTSTRAP: (state) => state,
} satisfies ModelFor<Spec>

const C: Comp<Spec & { actions: ModelActions<typeof model> }> = ({ state, label, context }) => <div>{label}{state.count}{context.csrf}</div>
C.intent = intent
C.model = model
C.timers = () => ({ t: { after: 0, action: 'SAVED' as const } })

// ModelActions: the reducers' data, by name, without the built-ins
type MA = ModelActions<typeof model>
const ma1: MA['SAVED'] = { id: 'a' }
const ma2: MA['FAILED'] = { error: 1, request: 'x' }
const ma3: MA['UNION'] = null
// @ts-expect-error — a built-in isn't an action the model declares
type MA4 = MA['BOOTSTRAP']
void [ma1, ma2, ma3]

// Strictness survives: --------------------------------------------------------------------------------------
const wrongStateKey = {
  // @ts-expect-error — no such state key
  INC: (state) => ({ ...state, count: state.nope }),
} satisfies ModelFor<Spec>
void wrongStateKey

const wrongStateType = {
  // @ts-expect-error — count is a number
  INC: (state) => ({ ...state, count: 'x' }),
} satisfies ModelFor<Spec>
void wrongStateType

const wrongPayloadAnnotated = {
  // @ts-expect-error — the intent's INC is a number
  INC: (state, n: string) => ({ ...state, name: n }),
} satisfies ModelFor<Spec>
void wrongPayloadAnnotated

const wrongPayloadRead = {
  PICK: (state, d) => {
    // @ts-expect-error — Payload has no 'nope'
    d.nope
    return state
  },
} satisfies ModelFor<Spec>
void wrongPayloadRead

const wrongNextData = {
  INC: (state, _n, next) => {
    // @ts-expect-error — NAME carries a string
    next('NAME', 42)
    return state
  },
} satisfies ModelFor<Spec>
void wrongNextData

const wrongContextKey = {
  INC: (state, _n, _next, { context }) => {
    // @ts-expect-error — not in Spec's context
    context.nope
    return state
  },
} satisfies ModelFor<Spec>
void wrongContextKey

const wrongBag = {
  INC: (state, _n, _next, props) => {
    // @ts-expect-error — not a prop
    props.nope
    return state
  },
} satisfies ModelFor<Spec>
void wrongBag

const wrongSinkReturn = {
  // @ts-expect-error — a STATE sink is a reducer or `true`
  INC: { STATE: 'not-a-reducer' },
} satisfies ModelFor<Spec>
void wrongSinkReturn

// a wrong action name where the component's actions are read (model + intent)
// @ts-expect-error — no such action
C.timers = () => ({ t: { after: 0, action: 'NOPE' as const } })
// @ts-expect-error — no such action
C.viewTransitions = ['NOPE']

// A typo'd model KEY is a new action to the types, as it is for any `.model = model` today (no excess-property
// check on a variable); sygnal-check reports it (SYG101 / SYG102 / SYG117).
const typoKey = { INCC: (state) => state } satisfies ModelFor<Spec>
void typoKey

// RootComp, calculated, drivers
type Root = { state: { a: number }; calculated: { twice: number } }
const rootModel = { ADD: (state, n: number) => ({ ...state, a: state.a + n + state.twice }) } satisfies ModelFor<Root>
const R: RootComp<Root & { actions: ModelActions<typeof rootModel> }> = ({ state }) => <div>{state.twice}</div>
R.model = rootModel
R.initialState = { a: 1 }
R.calculated = { twice: (s: { a: number }) => s.a * 2 }

// A component that keeps everything inline is unchanged, and still checks the model's keys
const Inline: Comp<{ state: State; actions: { GO: number } }> = ({ state }) => <div>{state.count}</div>
Inline.model = {
  GO: (state, n) => ({ ...state, count: n }),
  // @ts-expect-error — inline, an unknown key is an excess property
  NOPE: (state: State) => state,
}

// The guide's example (docs: integration/typescript)
type Quote = { text: string }
type QuoteState = { id: number; status: string; quote?: Quote }
const quoteIntent = ({ DOM }: IntentSources<QuoteState>) => ({ LOAD: DOM.click('.load') })
type QuoteSpec = { state: QuoteState; actions: ActionsOf<typeof quoteIntent> }
const quoteModel = {
  LOAD: {
    STATE: (state) => ({ ...state, status: 'loading' }),
    HTTP: (state) => ({ url: `/api/quotes/${state.id}`, ok: 'LOADED', error: 'FAILED' }),
  },
  LOADED: (state, quote: Quote) => ({ ...state, status: 'done', quote }),
  FAILED: (state, { status }: FetchFailure) => ({ ...state, status: status === 404 ? 'missing' : 'error' }),
} satisfies ModelFor<QuoteSpec>
const QuoteCard: Comp<QuoteSpec & { actions: ModelActions<typeof quoteModel> }> = ({ state }) => <div>{state.quote?.text ?? state.status}</div>
QuoteCard.intent = quoteIntent
QuoteCard.model = quoteModel
