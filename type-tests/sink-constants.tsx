/**
 * Constant sink values (G-077).
 *
 * The runtime sends a non-function, non-`true` value of a non-STATE sink as-is each time
 * the action fires (`LOG: 'saved'`). The types accept that for EVENTS, LOG, PARENT and
 * custom drivers, typed by the sink's value type where one is declared, and still reject
 * it for STATE (which needs a reducer) and as a whole model entry (the STATE shorthand).
 */
import type { Component, RootComponent, DriverSpec, ParentPayloadOf } from 'sygnal'
import type { Stream } from 'xstream'

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false
function expectType<T extends true>(): void {}

type State = { count: number }

// ── Untyped sinks: any non-function constant ────────────────────────────────

const App: RootComponent<State> = ({ state }) => <div>{state.count}</div>
App.model = {
  SAVE: {
    STATE: (state) => ({ ...state, count: state.count + 1 }),
    LOG: 'saved',
    EVENTS: { type: 'SAVED', data: 1 },
    PARENT: { kind: 'saved' },
    API: { url: '/save', method: 'POST' },
  },
  PING: { LOG: 42, API: ['a', 'b'], PARENT: null },
  // reducers next to constants keep their contextual parameter types
  LOG_COUNT: { LOG: (state) => state.count.toFixed(0) },
}

App.model = {
  // @ts-expect-error — STATE needs a reducer, not a constant
  BAD_STATE: { STATE: 'reset' },
}

App.model = {
  // @ts-expect-error — a bare constant entry is the STATE shorthand, which needs a reducer
  BAD_ENTRY: 'reset',
}

// ── Typed sinks: the constant must match the sink's value type ───────────────

type Drivers = { API: DriverSpec<Stream<{ url: string }>, { url: string }> }
type Actions = { SAVE: void; START: void }

const Typed: Component<State, {}, Drivers, Actions, {}, {}, { LOG: string }> = ({ state }) => <div>{state.count}</div>
Typed.model = {
  START: { LOG: 'Starting application...', API: { url: '/start' } },
  SAVE: { LOG: (state) => `count ${state.count}` },
}

Typed.model = {
  // @ts-expect-error — LOG is typed as string
  START: { LOG: 42 },
}

Typed.model = {
  // @ts-expect-error — API sends { url: string }
  START: { API: { path: '/start' } },
}

// ── PARENT constants are visible to CHILD.select() ──────────────────────────

function Child() { return <div /> }
Child.model = {
  DONE: { PARENT: 'done' },
  MOVE: { PARENT: (state: { id: string }) => state.id.length },
}
expectType<Equal<ParentPayloadOf<typeof Child>, string | number>>()
