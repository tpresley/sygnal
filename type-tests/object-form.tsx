/**
 * Comp<{ ... }> / RootComp<{ ... }>: Component and RootComponent typed by name. Each key is the
 * positional argument of the same meaning; what's left out takes Component's default; `parent`
 * types the PARENT sink, so the parent's CHILD.select(C) is typed; a misspelled key is an
 * error. The positional forms are unchanged, including a state that has a `state` key.
 */
import { run, renderComponent } from 'sygnal'
import type {
  Component, RootComponent, Comp, RootComp, ComponentSpec, ActionsOf, IntentSources, ParentPayloadOf,
} from 'sygnal'
import type { Stream } from 'xstream'

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false
function expectType<T extends true>(): void {}

type Task = { id: string; title: string; done: boolean }
const taskIntent = ({ DOM }: IntentSources<Task>) => ({
  TOGGLE: DOM.click('.toggle'),
  RENAME: DOM.input('.title').value(),
  DELETE: DOM.click('.delete'),
})
type TaskActions = ActionsOf<typeof taskIntent>

// ═══ 1. The same types as the positional form ═══════════════════════════════

expectType<Equal<Comp<{ state: Task }>, Component<Task>>>()
expectType<Equal<Comp<{ state: Task; props: { lane: string } }>, Component<Task, { lane: string }>>>()
expectType<Equal<Comp<{ state: Task; actions: TaskActions }>, Component<Task, { [prop: string]: any }, {}, TaskActions>>>()
expectType<Equal<
  Comp<{ state: Task; props: { lane: string }; actions: TaskActions; calculated: { label: string }; context: { theme: 'dark' } }>,
  Component<Task, { lane: string }, {}, TaskActions, { label: string }, { theme: 'dark' }>
>>()
expectType<Equal<Comp<{ state: Task; context: { a: 1 }; provided: { b: 2 } }>, Component<Task, { [prop: string]: any }, {}, {}, {}, { a: 1 }, {}, { b: 2 }>>>()
expectType<Equal<Comp, Component>>()
// optional keys (`props?: P`) read as the key's type
expectType<Equal<Comp<{ state: Task; props?: { lane: string } }>, Component<Task, { lane: string }>>>()
// a component with props only: any state
expectType<Equal<Comp<{ props: { label: string } }>, Component<any, { label: string }>>>()

expectType<Equal<RootComp<{ state: Task }>, RootComponent<Task>>>()
type Drivers = { API: { source: Stream<string>; sink: Stream<number> } }
expectType<Equal<RootComp<{ state: Task; drivers: Drivers; actions: TaskActions }>, RootComponent<Task, Drivers, TaskActions>>>()
expectType<Equal<RootComp<{ state: Task; sinks: { LOG: string } }>, RootComponent<Task, {}, {}, {}, {}, { LOG: string }>>>()

// ═══ 2. Checked like the positional form ════════════════════════════════════

const TaskCard: Comp<{ state: Task; props: { lane: string }; actions: TaskActions; parent: { taskId: string } }> =
  ({ state, lane }) => <li className={lane}>{state.title}</li>
TaskCard.intent = taskIntent
TaskCard.model = {
  TOGGLE: (state) => ({ ...state, done: !state.done }),
  RENAME: (state, title) => ({ ...state, title }),
  DELETE: { PARENT: (state) => ({ taskId: state.id }) },
}
TaskCard.model = {
  // @ts-expect-error: title is a string
  RENAME: (state, title: number) => ({ ...state, title }),
}
TaskCard.model = {
  // @ts-expect-error: the PARENT payload is { taskId: string }
  DELETE: { PARENT: (state) => ({ id: state.id }) },
}
TaskCard.model = {
  // @ts-expect-error: NOPE is not an action
  NOPE: (state) => state,
}
// @ts-expect-error: `lane` is a string prop
void (<TaskCard lane={1} />)

// ═══ 3. `parent` types the parent's CHILD.select ════════════════════════════

expectType<Equal<ParentPayloadOf<typeof TaskCard>, { taskId: string }>>()
type Lane = { tasks: Task[] }
const laneIntent = ({ CHILD }: IntentSources<Lane>) => ({
  REMOVE: CHILD.select(TaskCard).map((e) => e.taskId),
  // @ts-expect-error: the payload has no laneId
  BAD: CHILD.select(TaskCard).map((e) => e.laneId),
})
expectType<Equal<ActionsOf<typeof laneIntent>['REMOVE'], string>>()
// without `parent` (or sinks.PARENT): unknown, as an annotated positional Component
const Quiet: Comp<{ state: Task }> = ({ state }) => <p>{state.title}</p>
expectType<Equal<ParentPayloadOf<typeof Quiet>, unknown>>()
// `sinks: { PARENT }` is the same as `parent`
const Loud: Comp<{ state: Task; sinks: { PARENT: number; LOG: string } }> = ({ state }) => <p>{state.title}</p>
expectType<Equal<ParentPayloadOf<typeof Loud>, number>>()

// ═══ 4. Misspelled keys are errors ══════════════════════════════════════════

// @ts-expect-error: `action` is not a key (actions)
type Typo1 = Comp<{ state: Task; action: TaskActions }>
// @ts-expect-error: a root has no props
type Typo2 = RootComp<{ state: Task; props: { a: 1 } }>
// @ts-expect-error: a root has no parent
type Typo3 = RootComp<{ state: Task; parent: string }>
// @ts-expect-error: sinks are EVENTS / LOG / PARENT values
type Typo4 = Comp<{ state: Task; sinks: string }>
void (0 as unknown as [Typo1, Typo2, Typo3, Typo4])
// (the keys, for reference)
expectType<Equal<keyof ComponentSpec, 'state' | 'props' | 'drivers' | 'actions' | 'calculated' | 'context' | 'parent' | 'sinks' | 'provided'>>()

// ═══ 5. The positional form keeps its meaning ═══════════════════════════════

// a state machine's state with a `state` key (and a `props` key) is a state, not the object form
type Machine = { state: 'idle' | 'busy'; props: number }
const Light: Component<Machine> = ({ state }) => <p>{state.state}{state.props}</p>
Light.model = { GO: (s) => ({ ...s, state: 'busy' }) }
expectType<Equal<Parameters<typeof Light>[0]['state'], Machine>>()
// …and in the object form it is just `state`'s type
const Light2: Comp<{ state: Machine }> = ({ state }) => <p>{state.state}</p>
expectType<Equal<typeof Light2, typeof Light>>()

// ═══ 6. A root runs ═════════════════════════════════════════════════════════

type AppState = { tasks: Task[]; filter: 'all' | 'done' }
const appIntent = ({ DOM }: IntentSources<AppState>) => ({ FILTER: DOM.change('.filter').value() })
const App: RootComp<{ state: AppState; actions: ActionsOf<typeof appIntent> & { CLEAR: void } }> = ({ state }) => (
  <main>{state.tasks.length}</main>
)
App.initialState = { tasks: [], filter: 'all' }
App.intent = appIntent
App.model = {
  FILTER: (state, filter) => ({ ...state, filter: filter === 'done' ? 'done' : 'all' }),
  CLEAR: (state) => ({ ...state, tasks: [] }),
}
// @ts-expect-error: initialState is AppState
App.initialState = { tasks: [] }
run(App)

// renderComponent infers the state, as from a positional annotation
const t = renderComponent(App)
expectType<Equal<typeof t.state, AppState>>()

// ═══ 7. A view may return null, false or undefined (7.2: it renders nothing) ═══════════════

type BannerState = { show: boolean; text: string }
const Banner: Comp<{ state: BannerState }> = ({ state }) => (state.show ? <p>{state.text}</p> : null)
const Hidden: Component<BannerState> = ({ state }) => state.show && <p>{state.text}</p>
const Nothing: Comp<{ state: BannerState }> = () => undefined
const Root: RootComp<{ state: { banner: BannerState } }> = ({ state }) => (state.banner.show ? <Banner state="banner" /> : null)
// …and they are still components in JSX
const Page = () => <div><Banner state="banner" /><Hidden state="banner" /><Nothing state="banner" /></div>
run(Root)
void Page
