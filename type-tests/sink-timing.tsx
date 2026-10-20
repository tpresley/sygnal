// 7.0 timing: one contract. Outputs get the committed state; props.previousState is the state
// from before the action. There is no sinkState option.
import {run, renderComponent} from 'sygnal'
import type {RootComponent} from 'sygnal'
const C: RootComponent<{n: number}, {}, {GO: void}> = () => <p>timing</p>
C.initialState = {n: 0}
C.model = {GO: {
  STATE: s => ({n: s.n + 1}),
  EFFECT: (s, data, next, props) => {
    const current: number = props.state.n
    const previous: number = props.previousState.n
    const first: number = s.n
    // @ts-expect-error previousState retains the component state type
    const wrong: string = props.previousState.n
    void current; void previous; void first; void wrong
  },
}}
run(C, {})
renderComponent(C, {timingAudit: true})
// @ts-expect-error the option was removed: one timing contract in 7.0
run(C, {}, {sinkState: 'before'})
// @ts-expect-error not a renderComponent option
renderComponent(C, {sinkState: 'before'})
