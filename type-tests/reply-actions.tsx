// PLAN-3 1-T: reply actions (ok / error / key, abort by name), then/catch rejected,
// ok / error checked against a component's ACTIONS, and HYDRATE as an ordinary action (D66)
import xs from 'xstream'
import { makeFetchDriver, driverFromAsync, ABORT } from 'sygnal'
import type {
  Component, ActionsOf, IntentSources, FetchRequest, FetchSource, FetchFailure,
  AsyncRequest, AsyncDriverFromFunction, AsyncDriverError, ReplyRequest,
} from 'sygnal'

// ── FetchRequest: reply-action shape ────────────────────────────────
const replies: FetchRequest[] = [
  { url: '/api/q/1', ok: 'LOADED', error: 'FAILED' },
  { url: '/api/q/1', ok: 'LOADED', latest: true, key: 'quote' },
  { url: '/api/r', ok: 'GOT', parse: 'response' },
  { abort: 'LOADED' },                 // abort by action (or key) name
  { abort: true, key: 'quote' },       // abort by key
  { abort: true },                     // the whole scope
  { abort: true, category: 'search' }, // plain category
]
makeFetchDriver()(xs.fromArray(replies))

// @ts-expect-error a `then` key makes the request a thenable (SYG610): use ok
export const thenKey: FetchRequest = { url: '/x', then: 'LOADED' }
// @ts-expect-error a `catch` key (SYG610): use error
export const catchKey: FetchRequest = { url: '/x', catch: 'FAILED' }
// @ts-expect-error ok is an action name
export const okNumber: FetchRequest = { url: '/x', ok: 1 }
// @ts-expect-error abort is true or a name
export const abortFalse: FetchRequest = { abort: false }
// ordinary objects stay assignable (then?: never doesn't get in the way)
const built = { url: '/x', id: 7 }
export const plain: FetchRequest = built
const extras: ReplyRequest = { ok: 'A', error: 'B' }
export const spread: FetchRequest = { url: '/x', ...extras }

// FetchFailure: the error reply action's data
export const onFail = ({ error, status, body, request }: FetchFailure) => [error, status ?? 0, body, request.url]

// ── ok / error checked against ACTIONS ──────────────────────────────
type Quote = { text: string }
type State = { id: number; status: string; quote?: Quote }
type Drivers = { HTTP: { source: FetchSource; sink: FetchRequest } }

const intent = ({ DOM }: IntentSources<State, Drivers>) => ({ LOAD: DOM.click('.load') })
// reply actions are listed with their data: ok → the parsed body, error → FetchFailure
type Actions = ActionsOf<typeof intent> & { LOADED: Quote; FAILED: FetchFailure }

const QuoteView: Component<State, {}, Drivers, Actions> = ({ state }) => <div>{state.status}</div>
QuoteView.intent = intent
QuoteView.model = {
  LOAD: {
    STATE: (state) => ({ ...state, status: 'loading' }),
    HTTP: (state) => ({ url: `/api/quotes/${state.id}`, ok: 'LOADED', error: 'FAILED', latest: true }),
  },
  LOADED: (state, quote) => ({ ...state, status: 'done', quote: { text: quote.text } }),
  FAILED: (state, { status }) => ({ ...state, status: status === 404 ? 'missing' : 'error' }),
}

// D70: ok / error are plain strings in the types (no action-name check: a request built in a
// helper widens to `ok: string`, which a check would reject); sygnal-check SYG112 catches typos
const Loose2: Component<State, {}, Drivers, Actions> = ({ state }) => <div>{state.status}</div>
const widened = (id: number) => ({ url: `/api/quotes/${id}`, ok: 'LOADED', error: 'FAILED' })
Loose2.model = {
  LOAD: { HTTP: (state) => widened(state.id) },                       // helper, no `as const`
  LOADED: { HTTP: (state) => (state.id ? { url: '/next', ok: 'LOADED' } : ABORT) },
  FAILED: { HTTP: () => ({ abort: 'LOADED' }) },
}

// untyped components: no action list, nothing to check against
const Loose: Component<State, {}, Drivers> = ({ state }) => <div>{state.status}</div>
Loose.model = { LOAD: { HTTP: () => ({ url: '/x', ok: 'WHATEVER' }) } }
function Plain() { return <div /> }
Plain.model = { LOAD: { HTTP: () => ({ url: '/x', ok: 'ANY', error: 'NAME' }) } }

// ── driverFromAsync: reply actions ────────────────────────────────
type QuoteReq = AsyncRequest<{ value: number }>
const quoteDriver = driverFromAsync<QuoteReq, number>(async (n: number) => n * 10, { args: 'value' })
export const asyncSource: AsyncDriverFromFunction = quoteDriver(xs.of<QuoteReq>({ value: 2, ok: 'GOT', error: 'FAILED' }))
// @ts-expect-error then is not allowed on an async request either
export const asyncThen: QuoteReq = { value: 1, then: 'GOT' }
// @ts-expect-error the request's own fields stay typed
export const asyncBad: QuoteReq = { value: 'x', ok: 'GOT' }

type AsyncDrivers = { QUOTE: { source: AsyncDriverFromFunction; sink: QuoteReq } }
const Calc: Component<{ n: number }, {}, AsyncDrivers, { GO: null; GOT: number; FAILED: AsyncDriverError }> = ({ state }) => <div>{state.n}</div>
Calc.model = {
  GO: { QUOTE: (state) => ({ value: state.n, ok: 'GOT', error: 'FAILED' }) },
  GOT: (state, n) => ({ ...state, n }),
  FAILED: (state, { error }) => (error ? state : state),
}

// ── HYDRATE is an ordinary action key now (D66) ─────────────────────
type CounterActions = { INC: null }
const Counter: Component<{ n: number }, {}, {}, CounterActions> = ({ state }) => <div>{state.n}</div>
Counter.model = {
  INC: (state) => ({ n: state.n + 1 }),
  BOOTSTRAP: (state) => state,
  INITIALIZE: (state) => state,
  DISPOSE: (state) => state,
}
Counter.model = {
  // @ts-expect-error HYDRATE is not a built-in: list it in the actions to use it
  HYDRATE: (state: { n: number }) => state,
}
const Hydrating: Component<{ n: number }, {}, {}, { HYDRATE: { n: number } }> = ({ state }) => <div>{state.n}</div>
Hydrating.model = { HYDRATE: (state, data) => ({ n: state.n + data.n }) }
Hydrating.model = {
  // @ts-expect-error its data has the listed type
  HYDRATE: (state, data: string) => state,
}

export { QuoteView, Loose2, Loose, Plain, Calc, Counter, Hydrating, onFail as _onFail }
