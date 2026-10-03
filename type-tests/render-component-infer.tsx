// PLAN-3 1-T / G-142: renderComponent infers the state type, so test predicates need no
// annotation under strict (no TS7006 in `t.next(s => ...)`); untyped usage stays `any`
import { renderComponent, component } from 'sygnal'
import type { Component, RenderResult, ActionsOf, IntentSources } from 'sygnal'

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false
const assert = <T extends true>() => {}
type IsAny<T> = 0 extends (1 & T) ? true : false

type State = { count: number; label: string }

// 1. Component<State, ...> annotation
const intent = ({ DOM }: IntentSources<State>) => ({ INC: DOM.click('.inc') })
const Counter: Component<State, any, {}, ActionsOf<typeof intent>> = ({ state }: { state: State }) => <div>{state.count}</div>
Counter.intent = intent
Counter.model = { INC: (state) => ({ ...state, count: state.count + 1 }) }
Counter.initialState = { count: 0, label: 'x' }

// 2. a plain function with a typed view
function Typed({ state }: { state: State }) { return <div>{state.label}</div> }
Typed.initialState = { count: 0, label: 'x' }

// 3. a plain function with an untyped view and an initialState
function Loose({ state }: any) { return <div>{state.n}</div> }
Loose.initialState = { n: 0 }

// 4. calculated fields are part of the recorded state
type Calc = { double: number }
const WithCalc: Component<State, {}, {}, {}, Calc> = ({ state }) => <div>{state.double}</div>
WithCalc.calculated = { double: (s) => s.count * 2 }

// 5. a view with its own required props
const Titled: Component<State, { title: string }> = ({ state, title }) => <h1>{title}{state.count}</h1>

// 6. nothing typed
function Untyped() { return <div /> }

async function check() {
  const t = renderComponent(Counter)
  assert<Equal<typeof t, RenderResult<State>>>()
  await t.ready()
  t.simulateEvent('.inc', 'click')
  // no annotation on `s` (strict: no TS7006), and the result is typed
  const s = await t.next(s => s.count > 0)
  const n: number = s.count
  const w = await t.waitForState(s => s.label === 'x')
  const label: string = w.label
  const counts: number[] = t.states.map(s => s.count)
  const latest: number = t.state.count
  t.state$.map(s => s.count)
  // @ts-expect-error not a field of State
  await t.next(s => s.cnt > 0)
  // @ts-expect-error the predicate's parameter is State
  await t.next((s: { other: string }) => s.other === '')
  t.dispose()

  const typed = renderComponent(Typed)
  assert<Equal<typeof typed, RenderResult<State>>>()
  await typed.next(s => s.label.length > 0)

  const loose = renderComponent(Loose)
  assert<Equal<typeof loose, RenderResult<{ n: number }>>>()
  await loose.next(s => s.n === 1)

  const calc = renderComponent(WithCalc)
  assert<Equal<typeof calc, RenderResult<State & Calc>>>()
  await calc.next(s => s.double === 2 && s.count === 1)

  const titled = renderComponent(Titled)
  assert<Equal<typeof titled, RenderResult<State>>>()

  // untyped: any, as before
  const u = renderComponent(Untyped)
  assert<IsAny<typeof u.state>>()
  await u.next(s => s.whatever === 1)
  const fromAny = renderComponent(null as any)
  assert<IsAny<typeof fromAny.state>>()
  const viaFactory = renderComponent(component({ view: ({ state }) => <div>{state.x}</div> }))
  assert<IsAny<typeof viaFactory.state>>()
  const factoryComponent = component({ view: ({ state }) => <div>{state.x}</div> })
  const fromFactory = renderComponent(factoryComponent)
  assert<IsAny<typeof fromFactory.state>>()

  // explicit state type for an untyped component
  const explicit = renderComponent<State>(Untyped)
  await explicit.next(s => s.count === 0)
  // @ts-expect-error the explicit type must match a typed component's state
  renderComponent<{ other: string }>(Typed)

  // a handle declared before it is assigned (beforeEach): name the type
  let handle: RenderResult<State>
  handle = renderComponent(Counter)
  await handle.next(s => s.count === 1)
  // RenderResult without a type argument is RenderResult<any>, and every typed result fits it
  const anyHandle: RenderResult = renderComponent(Counter)
  assert<IsAny<typeof anyHandle.state>>()

  return [n, label, counts, latest]
}

export default check
