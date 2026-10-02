/**
 * Type tests for the typed-links gaps found by the TypeScript eval (E10, PLAN-2 4-T),
 * with an EMPTY SygnalEvents registry (registry-dependent cases are in ./registry).
 *
 * 1. RootComponent: the view's `state` is typed by STATE (PROPS was `any`)
 * 2. JSX: a typed sub-component takes `state="slice"` / a lens / no `state` prop
 * 3. Context: the view's `context` is not optional; provided vs consumed context
 * 4. `calculated`: an intent annotated with IntentSources<State> is accepted
 * 5. CHILD.select(Child) of an annotated child without a PARENT type is `unknown`, not `any`
 * 6. DOM shorthands are typed with the specific event (KeyboardEvent, ...)
 */
import { Collection, run } from 'sygnal'
import type {
  Component,
  RootComponent,
  ActionsOf,
  IntentSources,
  ParentPayloadOf,
  Lens,
} from 'sygnal'

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false
function expectType<T extends true>(): void {}

// ═══ 1. RootComponent view typed by STATE ═══════════════════════════════════

type Task = { id: number; title: string; done: boolean }
type RootState = { tasks: Task[]; pinnedId: number | null }

const Root: RootComponent<RootState> = ({ state }) => {
  expectType<Equal<typeof state, RootState>>()
  // callbacks over state fields are contextually typed (TS7006 when state was `any`)
  const pinned = state.tasks.find((task) => task.id === state.pinnedId)
  return <div className="root">{pinned ? pinned.title : 'none'}</div>
}
Root.initialState = { tasks: [], pinnedId: null }

type RootCalc = { open: number }
const RootWithCalc: RootComponent<RootState, {}, {}, RootCalc> = ({ state }) => {
  expectType<Equal<typeof state, RootState & RootCalc>>()
  return <div>{state.open}</div>
}
RootWithCalc.calculated = { open: (state) => state.tasks.filter((t) => !t.done).length }

const RootBad: RootComponent<RootState> = ({ state }) => {
  // @ts-expect-error — RootState has no 'nope'
  return <div>{state.nope}</div>
}
void RootBad

// run() still infers from a RootComponent and from a plain Component
const app1 = run(Root)
app1.sources.STATE.stream.map((s) => s.tasks.length)
const PlainRoot: Component<RootState> = ({ state }) => <div>{state.tasks.length}</div>
run(PlainRoot)

// ═══ 2. JSX props of a typed sub-component ══════════════════════════════════

type EditorState = { draft: string; saved: string }
const Editor: Component<EditorState, {}, {}, {}> = ({ state }) => {
  expectType<Equal<typeof state, EditorState>>()
  return <textarea className="draft" value={state.draft} />
}

type PanelProps = { title: string; compact?: boolean }
const Panel: Component<{}, PanelProps> = ({ title, compact }) => (
  <aside className={compact ? 'panel compact' : 'panel'}>{title}</aside>
)

// Expando component (no Component<> annotation)
function TaskCard({ state }: { state: Task }) {
  return <div className="task">{state.title}</div>
}

// Default PROPS (index signature): any extra prop is fine
const Loose: Component<EditorState> = ({ state }) => <div>{state.draft}</div>

type ShellState = { editor: EditorState; task: Task }
const editorLens: Lens<ShellState, EditorState> = {
  get: (s) => s.editor,
  set: (s, editor) => ({ ...s, editor }),
}

const Shell: Component<ShellState> = () => (
  <div>
    <Editor state="editor" />
    <Editor state={editorLens} />
    <Editor />
    <Panel title="Details" />
    <Panel title="Details" compact state="task" />
    <TaskCard state="task" />
    <TaskCard />
    <Loose state="editor" anything={1} />
    {/* @ts-expect-error — `state` is a slice name or a lens, not a number */}
    <Editor state={42} />
    {/* @ts-expect-error — required prop 'title' is missing */}
    <Panel />
    {/* @ts-expect-error — 'title' is a string */}
    <Panel title={1} />
    {/* @ts-expect-error — Panel has no 'subtitle' prop */}
    <Panel title="x" subtitle="y" />
  </div>
)
void Shell

// Built-in JSX components keep their own props
const builtins = (
  <div>
    <Collection of={TaskCard} from="tasks" className="list" />
    {/* @ts-expect-error — Collection needs `from` */}
    <Collection of={TaskCard} />
  </div>
)
void builtins

// ═══ 3. Context ════════════════════════════════════════════════════════════

type AppContext = { theme: 'light' | 'dark'; selectedId: number | null }

const Row: Component<Task, {}, {}, {}, {}, AppContext> = ({ state, context }) => {
  // context is always present (not `AppContext | undefined`)
  expectType<Equal<typeof context, AppContext>>()
  const selected = context.selectedId === state.id
  return <div className={selected ? `row ${context.theme} selected` : 'row'}>{state.title}</div>
}
void Row

// The provider: CONTEXT doubles as the provided context by default (every key required)
type ProviderState = { theme: 'light' | 'dark'; selectedId: number | null }
const Provider: Component<ProviderState, {}, {}, {}, {}, AppContext> = ({ context }) => <div>{context.theme}</div>
Provider.context = {
  theme: (state) => state.theme,
  selectedId: (state) => state.selectedId,
}
// @ts-expect-error — 'selectedId' is missing from the provided context
Provider.context = { theme: (state) => state.theme }

// Consumes AppContext, provides only { depth } (8th type parameter: PROVIDED_CONTEXT)
type LocalContext = { depth: number }
const Section: Component<{ level: number }, {}, {}, {}, {}, AppContext & LocalContext, {}, LocalContext> = ({ context }) => (
  <section data-theme={context.theme}>{context.depth}</section>
)
Section.context = { depth: (state) => state.level }
// @ts-expect-error — 'theme' is not part of what Section provides
Section.context = { depth: (state) => state.level, theme: () => 'dark' as const }

// ═══ 4. `calculated` + IntentSources<State> ═════════════════════════════════

type BoardState = { lists: { id: string; cards: number[] }[] }
type BoardCalc = { totalCards: number }

// The documented annotation: IntentSources<State> (without the calculated fields)
const boardIntent = ({ DOM, STATE }: IntentSources<BoardState>) => ({
  ADD: DOM.click('.add'),
  SIZE: STATE.stream.map((s) => s.lists.length),
})

type BoardActions = ActionsOf<typeof boardIntent>
type Board = Component<BoardState, {}, {}, BoardActions, BoardCalc>
const boardView: Board = ({ state }) => <div>{state.totalCards}</div>

// (one component per case: TS reports "Duplicate identifier" when the same static is
// assigned both a named function and an inline one)
const Board1: Board = boardView
Board1.calculated = { totalCards: (state) => state.lists.reduce((n, l) => n + l.cards.length, 0) }
Board1.intent = boardIntent

// annotating with the calculated fields included keeps working
const boardIntentWithCalc = ({ DOM }: IntentSources<BoardState & BoardCalc>) => ({
  ADD: DOM.click('.add'),
  SIZE: DOM.click('.size').mapTo(1),
})
const Board2: Board = boardView
Board2.intent = boardIntentWithCalc

// an inline intent still sees the calculated fields on STATE
const Board3: Board = boardView
Board3.intent = ({ DOM, STATE }) => ({
  ADD: DOM.click('.add'),
  SIZE: STATE.stream.map((s) => {
    expectType<Equal<typeof s, BoardState & BoardCalc>>()
    return s.totalCards
  }),
})

// an intent annotated with an unrelated state is still rejected
const wrongIntent = ({ DOM }: IntentSources<{ other: string }>) => ({ ADD: DOM.click('.add') })
const Board4: Board = boardView
// @ts-expect-error — the intent's sources are for a different state
Board4.intent = wrongIntent

// ═══ 5. CHILD.select(Child) of an annotated child ═══════════════════════════

const pickIntent = ({ DOM }: IntentSources<Task>) => ({ PICK: DOM.click('.pick') })

// A child annotated with Component<...> but without `{ PARENT: T }`: the payload can't be
// inferred from the annotation, so it is `unknown` (it used to be a silent `any`)
const PickRow: Component<Task, {}, {}, ActionsOf<typeof pickIntent>> = ({ state }) => <div>{state.title}</div>
PickRow.intent = pickIntent
PickRow.model = { PICK: { PARENT: (state) => ({ taskId: state.id }) } }
expectType<Equal<ParentPayloadOf<typeof PickRow>, unknown>>()

// With the 7th type parameter it is typed
type PickRequest = { taskId: number }
const TypedPickRow: Component<Task, {}, {}, ActionsOf<typeof pickIntent>, {}, {}, { PARENT: PickRequest }> = ({ state }) => (
  <div>{state.title}</div>
)
TypedPickRow.intent = pickIntent
TypedPickRow.model = { PICK: { PARENT: (state) => ({ taskId: state.id }) } }
expectType<Equal<ParentPayloadOf<typeof TypedPickRow>, PickRequest>>()

const listIntent = ({ CHILD }: IntentSources<RootState>) => ({
  TYPED: CHILD.select(TypedPickRow).map((r) => r.taskId),
  UNTYPED: CHILD.select(PickRow),
  EXPLICIT: CHILD.select<PickRequest>(PickRow),
})
expectType<Equal<ActionsOf<typeof listIntent>['TYPED'], number>>()
expectType<Equal<ActionsOf<typeof listIntent>['UNTYPED'], unknown>>()
expectType<Equal<ActionsOf<typeof listIntent>['EXPLICIT'], PickRequest>>()

const badListIntent = ({ CHILD }: IntentSources<RootState>) => ({
  // @ts-expect-error — the untyped child's payload is unknown: no silent field access
  WRONG: CHILD.select(PickRow).map((r) => r.id),
})
void badListIntent

// ═══ 6. DOM shorthand event types ═══════════════════════════════════════════

const domIntent = ({ DOM }: IntentSources<EditorState>) => ({
  ENTER: DOM.keydown('.draft').filter((e) => e.key === 'Enter' && !e.shiftKey),
  CLICK_X: DOM.click('.x').map((e) => e.clientX),
  WHEEL: DOM.wheel('.x').map((e) => e.deltaY),
  FOCUS: DOM.focusin('.x').map((e) => e.relatedTarget),
  DRAG: DOM.dragstart('.x').map((e) => e.dataTransfer),
  INPUT: DOM.input('.draft').value(),
  CUSTOM: DOM['my-event']('.x'),
})
type DomActions = ActionsOf<typeof domIntent>
expectType<Equal<DomActions['ENTER'], KeyboardEvent>>()
expectType<Equal<DomActions['CLICK_X'], number>>()
expectType<Equal<DomActions['INPUT'], string>>()
expectType<Equal<DomActions['CUSTOM'], Event>>()

// same type as DOM.select(...).events(...)
const sameIntent = ({ DOM }: IntentSources<EditorState>) => ({
  A: DOM.keydown('.x'),
  B: DOM.select('.x').events('keydown'),
})
expectType<Equal<ActionsOf<typeof sameIntent>['A'], ActionsOf<typeof sameIntent>['B']>>()

const badDomIntent = ({ DOM }: IntentSources<EditorState>) => ({
  // @ts-expect-error — a MouseEvent has no 'key'
  BAD: DOM.click('.x').map((e) => e.key),
})
void badDomIntent
// DOM.select is still the selector method
const sel = ({ DOM }: IntentSources<EditorState>) => ({ S: DOM.select('.x').events('click') })
void sel
