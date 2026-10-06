/**
 * Type tests for typed links (PLAN-1 1B) with an EMPTY SygnalEvents registry.
 *
 * - ActionsOf<typeof intent>: model keys and reducer data checked against the intent
 * - CHILD.select(Comp): stream type inferred from the child's PARENT sink
 * - Collection `from`: constrained to array keys when the parent State is given
 * - event() / emit() with no registry: untyped, same as before
 *
 * Registry-dependent behavior (module augmentation) lives in ./registry, which is compiled
 * as a separate program (see test/types.test.ts) so the augmentation doesn't leak here.
 */
import { xs, Collection, event, emit } from 'sygnal'
import type {
  Component,
  ActionsOf,
  IntentSources,
  ParentPayloadOf,
  CollectionProps,
  ArrayKeysOf,
  EventName,
  EventPayload,
  RegisteredEvent,
  Event,
  Lense,
} from 'sygnal'
import type { Stream } from 'xstream'

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false
function expectType<T extends true>(): void {}
declare function isAny<T>(value: T): 0 extends (1 & T) ? true : false

// ═══ 1. ActionsOf<typeof intent> ═════════════════════════════════════════════

type CounterState = { count: number; name: string }

// Recommended pattern: declare the intent as a const FIRST (annotating its sources with
// IntentSources<State>), derive the actions from it, then type the component with them.
const counterIntent = ({ DOM }: IntentSources<CounterState>) => ({
  INCREMENT: DOM.click('.inc').mapTo(1),
  RENAME:    DOM.input('.name').value(),
  RESET:     DOM.click('.reset'),
})

type CounterActions = ActionsOf<typeof counterIntent>

expectType<Equal<CounterActions['INCREMENT'], number>>()
expectType<Equal<CounterActions['RENAME'], string>>()
expectType<Equal<keyof CounterActions, 'INCREMENT' | 'RENAME' | 'RESET'>>()

// ActionsOf also accepts the intent's return object type directly
type FromObject = ActionsOf<{ A: Stream<number>; B: Stream<{ id: string }> }>
expectType<Equal<FromObject, { A: number; B: { id: string } }>>()

// MemoryStream payloads are unwrapped too
type FromMemory = ActionsOf<() => { M: ReturnType<Stream<boolean>['remember']> }>
expectType<Equal<FromMemory['M'], boolean>>()

const Counter: Component<CounterState, {}, {}, CounterActions> = ({ state }) => (
  <div>
    <span className="count">{state.count}</span>
    <input className="name" value={state.name} />
    <button className="inc">+</button>
    <button className="reset">reset</button>
  </div>
)

Counter.initialState = { count: 0, name: '' }
Counter.intent = counterIntent

Counter.model = {
  // built-ins stay allowed
  BOOTSTRAP: (state) => state,
  DISPOSE: { EFFECT: () => {} },
  INCREMENT: (state, by) => {
    const n: number = by
    return { ...state, count: state.count + n }
  },
  RENAME: (state, name) => ({ ...state, name: name.trim() }),
  RESET: (state) => ({ ...state, count: 0 }),
}

// ✗ a model key that the intent doesn't produce
Counter.model = {
  // @ts-expect-error — 'INCREMNT' is not an action of counterIntent
  INCREMNT: (state: CounterState) => state,
}

// ✗ wrong reducer data type (INCREMENT carries a number)
Counter.model = {
  // @ts-expect-error — data is number, not string
  INCREMENT: (state, by: string) => ({ ...state, name: by }),
}

// ✗ using a string method on a number payload
Counter.model = {
  // @ts-expect-error — 'trim' doesn't exist on number
  INCREMENT: (state, by) => ({ ...state, name: by.trim() }),
}

// ── Escape hatch for actions reached only through next() ───────────────────

type SaveActions = ActionsOf<typeof counterIntent> & { SAVED: { id: string } }

const Saver: Component<CounterState, {}, {}, SaveActions> = ({ state }) => <div>{state.count}</div>
Saver.intent = counterIntent // the intent need not produce SAVED
Saver.model = {
  RESET: {
    EFFECT: (_state, _data, next) => {
      next('SAVED', { id: 'a' })
      // @ts-expect-error — SAVED carries { id: string }
      next('SAVED', 42)
      // @ts-expect-error — NOPE is not an action
      next('NOPE')
    },
  },
  SAVED: (state, saved) => ({ ...state, name: saved.id }),
}

// Without the escape hatch, a next()-only action is rejected as a model key
Counter.model = {
  // @ts-expect-error — SAVED isn't produced by the intent; add it via `& { SAVED: ... }`
  SAVED: (state: CounterState) => state,
}

// ═══ 2. Typed CHILD.select(Comp) ═════════════════════════════════════════════

// Child whose model is assigned without a Component<> annotation (expando): the PARENT
// sink's return type is visible on `typeof TaskCard`.
function TaskCard({ state }: { state: { id: string; title: string } }) {
  return <div className="task">{state.title}</div>
}
TaskCard.model = {
  DELETE: {
    PARENT: (state: { id: string }) => ({ type: 'delete' as const, taskId: state.id }),
  },
}

expectType<Equal<ParentPayloadOf<typeof TaskCard>, { type: 'delete'; taskId: string }>>()

// Object-form PARENT entries are unioned (R5: 'ACTION | PARENT' keys were removed, D164)
function Toggle() { return <div /> }
Toggle.model = {
  FLIP: { PARENT: (state: { on: boolean }) => state.on },
  NAME: { PARENT: () => 'name' },
}
expectType<Equal<ParentPayloadOf<typeof Toggle>, boolean | string>>()

// Fallbacks to any: no model / PARENT: true only
function Plain() { return <div /> }
expectType<Equal<0 extends (1 & ParentPayloadOf<typeof Plain>) ? true : false, true>>()
// An annotated Component without `{ PARENT: T }` in SINK_RETURNS: unknown (4-T; was any)
expectType<Equal<ParentPayloadOf<typeof Counter>, unknown>>()
function PassThrough() { return <div /> }
PassThrough.model = { CLICK: { PARENT: true } }
expectType<Equal<0 extends (1 & ParentPayloadOf<typeof PassThrough>) ? true : false, true>>()

type LaneState = { id: string; title: string; tasks: { id: string; title: string }[]; tags?: string[]; count: number }

const laneIntent = ({ CHILD }: IntentSources<LaneState>) => ({
  DELETE_TASK: CHILD.select(TaskCard).map((e) => e.taskId),
  ANY_CHILD:   CHILD.select(Plain),                  // falls back to Stream<any>
  EXPLICIT:    CHILD.select<number>(Plain),          // explicit type argument still works
})

type LaneActions = ActionsOf<typeof laneIntent>
expectType<Equal<LaneActions['DELETE_TASK'], string>>()
expectType<Equal<ReturnType<typeof isAny<LaneActions['ANY_CHILD']>>, true>>()
// R5 (D163): CHILD.select('Name') was removed
// @ts-expect-error CHILD.select takes the component, not its name
const byName = ({ CHILD }: IntentSources<LaneState>) => CHILD.select('TaskCard')
void byName
expectType<Equal<LaneActions['EXPLICIT'], number>>()

const badLaneIntent = ({ CHILD }: IntentSources<LaneState>) => ({
  // @ts-expect-error — TaskCard's PARENT payload has no 'laneId'
  BAD: CHILD.select(TaskCard).map((e) => e.laneId),
})
void badLaneIntent

// ═══ 3. Collection `from` ════════════════════════════════════════════════════

expectType<Equal<ArrayKeysOf<LaneState>, 'tasks' | 'tags'>>()

// Unknown parent state (default): any string or Lense, as before
const untypedFrom: CollectionProps = { of: TaskCard, from: 'anything' }
void untypedFrom
const untypedJsx = <Collection of={TaskCard} from="whatever" />
void untypedJsx

// Known parent state: only array-valued keys
const typedFrom: CollectionProps<{}, LaneState> = { of: TaskCard, from: 'tasks' }
void typedFrom
// @ts-expect-error — 'title' is a string field, not an array
const typedFromBad: CollectionProps<{}, LaneState> = { of: TaskCard, from: 'title' }
// @ts-expect-error — 'nope' is not a key of LaneState
const typedFromMissing: CollectionProps<{}, LaneState> = { of: TaskCard, from: 'nope' }
void typedFromBad; void typedFromMissing

// Lense alternative keeps working
const tasksLense: Lense<LaneState, LaneState['tasks']> = {
  get: (s) => s.tasks,
  set: (s, tasks) => ({ ...s, tasks }),
}
const typedLense: CollectionProps<{}, LaneState> = { of: TaskCard, from: tasksLense }
void typedLense
const lenseJsx = <Collection of={TaskCard} from={tasksLense} />
void lenseJsx

// In JSX: bind the parent state with an instantiation expression
const LaneCollection = Collection<{ compact?: boolean }, LaneState>
const okJsx = <LaneCollection of={TaskCard} from="tasks" compact />
// @ts-expect-error — 'count' is a number field, not an array
const badJsx = <LaneCollection of={TaskCard} from="count" />
void okJsx; void badJsx

// ═══ 4. event() / emit() with an EMPTY registry (untyped, as before) ═════════

expectType<Equal<EventName, string>>()
expectType<Equal<ReturnType<typeof isAny<EventPayload<'X'>>>, true>>()
expectType<Equal<RegisteredEvent, Event<any>>>()

const anyEvent1 = event('ANYTHING')
const anyEvent2 = event('SET_MODE', 'dark')
const anyEvent3 = event('WITH_FN', (state, data) => ({ state, data }))
expectType<Equal<ReturnType<typeof anyEvent1>['type'], 'ANYTHING'>>()
void anyEvent2; void anyEvent3

type LaneModelActions = { DELETE_LANE: MouseEvent; RENAME: string }
const Lane: Component<LaneState, {}, {}, LaneModelActions> = ({ state }) => <div>{state.title}</div>
Lane.model = {
  DELETE_LANE: {
    STATE: (state) => ({ ...state, title: '' }),
    // state is inferred from the component (LaneState) even with an empty registry
    EVENTS: event('DELETE_LANE', (state) => ({ laneId: state.id })),
  },
  RENAME: {
    // data is inferred from the action (string)
    EVENTS: event('RENAMED', (_state, title) => title.toUpperCase()),
    LOG: true,
  },
}

Lane.model = {
  DELETE_LANE: {
    // @ts-expect-error — LaneState has no 'laneId'
    EVENTS: event('DELETE_LANE', (state) => ({ laneId: state.laneId })),
  },
}

// emit() keeps its existing (untyped) shape
const emitted = emit('REFRESH')
expectType<Equal<typeof emitted, { EVENTS: (state: any, actionData: any, next: Function, props: any) => { type: string; data: any } }>>()
Lane.model = {
  DELETE_LANE: emit('DELETE_LANE', (state) => ({ laneId: state.id })),
  RENAME: emit('RENAMED', { static: true }),
}

// EVENTS.select stays untyped with an empty registry
const eventsIntent = ({ EVENTS }: IntentSources<LaneState>) => ({
  ANY: EVENTS.select('WHATEVER'),
  TYPED: EVENTS.select<number>('COUNT'),
})
expectType<Equal<ReturnType<typeof isAny<ActionsOf<typeof eventsIntent>['ANY']>>, true>>()
expectType<Equal<ActionsOf<typeof eventsIntent>['TYPED'], number>>()

void xs
