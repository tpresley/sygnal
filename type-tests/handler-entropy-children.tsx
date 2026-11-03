// ReducerExtras keeps now/random/uuid with index-signature props; children accept text
import type { Comp, Component, ViewProps, SygnalChild } from 'sygnal'
import { lazy } from 'sygnal'

type State = { at: number }

// the default PROPS ({ [prop: string]: any }): the entropy helpers stay typed
const A: Comp<{ state: State; actions: { TICK: void } }> = ({ state }) => <div>{state.at}</div>
A.model = {
  TICK: (state, _d, _n, props) => ({ at: props.now() + props.random() + props.uuid().length }),
}
const A2: Comp<{ state: State; actions: { TICK: void } }> = ({ state }) => <div>{state.at}</div>
A2.model = {
  TICK: (state, _d, _n, props: { now: () => number }) => ({ at: props.now() }),
}
// declared props: the helpers too, and a prop of the same name wins
const B: Comp<{ state: State; props: { label: string }; actions: { TICK: void } }> = ({ state }) => <div>{state.at}</div>
B.model = { TICK: (state, _d, _n, props) => ({ at: props.now() + props.label.length }) }
const C: Comp<{ state: State; props: { now: string }; actions: { TICK: void } }> = ({ state }) => <div>{state.at}</div>
C.model = {
  TICK: (state, _d, _n, props) => {
    const n: string = props.now
    // @ts-expect-error the component's own `now` prop (a string) wins over the helper
    props.now()
    return { at: n.length }
  },
}
// the old Component<STATE> form (PROPS = any) too
const D: Component<State> = ({ state }) => <div>{state.at}</div>
D.model = { TICK: (state, _d, _n, props: { now: () => number }) => ({ at: props.now() }) }

// children: text, numbers, elements, mixed and nested arrays, nothing
const ActionButton: Comp<{ props: { busyLabel?: string } }> = ({ children }) => <button>{children}</button>
export const P1 = () => <ActionButton>Save</ActionButton>
export const P2 = () => <ActionButton busyLabel="Save" />
export const P3 = () => <ActionButton><b>Save</b></ActionButton>
export const P4 = () => <ActionButton>{'Save'} <b>x</b></ActionButton>
export const P5 = () => <ActionButton>{3}{null}{false}{undefined}{[<i />, 'a', [1, <b />]]}</ActionButton>
// @ts-expect-error an object is not a child
export const P6 = () => <ActionButton>{{ a: 1 }}</ActionButton>

const Labeled = ({ children }: ViewProps<{}, { title: string }>) => <label>{children}</label>
export const P7 = () => <Labeled title="t">Name: <input /></Labeled>
const kids: SygnalChild = ['a', 1, <b />, [null, true]]
void kids

const Lazy = lazy(() => Promise.resolve({ default: ActionButton }))
export const P8 = () => <Lazy>Save</Lazy>
