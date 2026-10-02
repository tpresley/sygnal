/**
 * Type tests for the SygnalEvents registry (see ./events-registry.ts for the augmentation).
 * Compiled against both src/index.d.ts and the bundled dist/index.d.ts.
 */
import { event, emit } from 'sygnal'
import type {
  Component,
  IntentSources,
  ActionsOf,
  EventName,
  EventPayload,
  RegisteredEvent,
  EmittedEvent,
  Event,
} from 'sygnal'
import type { Stream } from 'xstream'

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false
function expectType<T extends true>(): void {}

// ── Registry helpers ─────────────────────────────────────────────────────────

expectType<Equal<EventName, 'DELETE_LANE' | 'RESET' | 'SET_MODE' | 'COUNT'>>()
expectType<Equal<EventPayload<'DELETE_LANE'>, { laneId: string }>>()
expectType<Equal<EventPayload<'COUNT'>, number>>()
expectType<Equal<
  RegisteredEvent,
  | { type: 'DELETE_LANE'; data: { laneId: string } }
  | { type: 'RESET'; data: void }
  | { type: 'SET_MODE'; data: 'light' | 'dark' }
  | { type: 'COUNT'; data: number }
>>()

// ── EVENTS.select ────────────────────────────────────────────────────────────

type BoardState = { id: string; lanes: { id: string }[]; mode: 'light' | 'dark' }

const boardIntent = ({ EVENTS }: IntentSources<BoardState>) => ({
  REMOVE_LANE: EVENTS.select('DELETE_LANE'),
  SET_MODE:    EVENTS.select('SET_MODE'),
  RESET:       EVENTS.select('RESET'),
})

const deleteLane$ = null! as ReturnType<typeof boardIntent>['REMOVE_LANE']
expectType<Equal<typeof deleteLane$, Stream<{ laneId: string }>>>()
expectType<Equal<ActionsOf<typeof boardIntent>['SET_MODE'], 'light' | 'dark'>>()

const badSelectIntent = ({ EVENTS }: IntentSources<BoardState>) => ({
  // @ts-expect-error — 'DELETE_LAEN' is not a registered event
  TYPO: EVENTS.select('DELETE_LAEN'),
})
void badSelectIntent

// ── event() ─────────────────────────────────────────────────────────────────

type LaneState = { id: string; title: string }
type LaneActions = { DELETE: MouseEvent; RESET_ALL: null; DARK: null; ADD: number }

const Lane: Component<LaneState, {}, {}, LaneActions> = ({ state }) => <div>{state.title}</div>

Lane.model = {
  DELETE: {
    STATE: (state) => ({ ...state, title: '' }),
    EVENTS: event('DELETE_LANE', (state) => ({ laneId: state.id })),
  },
  RESET_ALL: { EVENTS: event('RESET') },           // void payload may be omitted
  DARK: { EVENTS: event('SET_MODE', 'dark') },     // static payload
  ADD: { EVENTS: event('COUNT', (_state, n) => n + 1) },
}

const deleteSink = event('DELETE_LANE', { laneId: 'x' })
expectType<Equal<ReturnType<typeof deleteSink>, { type: 'DELETE_LANE'; data: { laneId: string } }>>()

Lane.model = {
  DELETE: {
    // @ts-expect-error — payload must be { laneId: string }
    EVENTS: event('DELETE_LANE', (state) => ({ laneId: state.title.length })),
  },
}

Lane.model = {
  // @ts-expect-error — 'NOPE' is not a registered event
  DARK: { EVENTS: event('NOPE', 'dark') },
}

// @ts-expect-error — 'blue' is not a valid SET_MODE payload
event('SET_MODE', 'blue')

// @ts-expect-error — DELETE_LANE requires a payload
event('DELETE_LANE')

// An unregistered name is ONE error, on the name argument (4-T): no second error on the
// model entry (an unexpected error on the `EVENTS:` line would fail this file)
Lane.model = {
  DELETE: {
    EVENTS:
      // @ts-expect-error — 'DELETE_LAEN' is not a registered event
      event('DELETE_LAEN', (state) => ({ laneId: state.id })),
  },
}
// …because a sink typed with every registered name emits any registered event
expectType<Equal<EmittedEvent<EventName>, RegisteredEvent>>()
expectType<Equal<EmittedEvent<'COUNT'>, { type: 'COUNT'; data: number }>>()

// The payload function's `data` is typed from the action (DOM shorthands are typed too)
const clickIntent = ({ DOM }: IntentSources<LaneState>) => ({ DELETE: DOM.click('.delete') })
const Clicky: Component<LaneState, {}, {}, ActionsOf<typeof clickIntent>> = ({ state }) => <div>{state.title}</div>
Clicky.model = {
  DELETE: {
    EVENTS: event('COUNT', (_state, click) => {
      expectType<Equal<typeof click, HTMLElementEventMap['click']>>()
      return click.clientX
    }),
  },
}

// ── emit() is checked against the registry too ──────────────────────────────

Lane.model = {
  DELETE: emit('DELETE_LANE', (state) => ({ laneId: state.id })),
  RESET_ALL: emit('RESET'),
  DARK: emit('SET_MODE', 'light'),
}

// @ts-expect-error — 'NOPE' is not a registered event
emit('NOPE')

// @ts-expect-error — payload must be { laneId: string }
emit('DELETE_LANE', () => ({ laneId: 1 }))

// @ts-expect-error — 'blue' is not a valid SET_MODE payload
emit('SET_MODE', 'blue')

// ── Raw EVENTS sink returns are checked against the registry ────────────────

Lane.model = {
  DELETE: { EVENTS: (state) => ({ type: 'DELETE_LANE', data: { laneId: state.id } }) },
}

Lane.model = {
  // @ts-expect-error — 'NOPE' is not a registered event
  DELETE: { EVENTS: (state) => ({ type: 'NOPE', data: state.id }) },
}

Lane.model = {
  // @ts-expect-error — data for COUNT must be a number
  ADD: { EVENTS: () => ({ type: 'COUNT', data: 'one' }) },
}

// An explicit SINK_RETURNS EVENTS type still takes precedence over the registry
type CustomSinkReturns = { EVENTS: Event<string> }
const Custom: Component<LaneState, {}, {}, LaneActions, {}, {}, CustomSinkReturns> = ({ state }) => <div>{state.title}</div>
Custom.model = {
  DELETE: { EVENTS: (state) => ({ type: 'ANY_NAME', data: state.title }) },
}
