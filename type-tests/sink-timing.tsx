import {run, renderComponent, defineBehavior} from 'sygnal'
import type {RootComponent, SinkState} from 'sygnal'
const mode: SinkState = 'after'
const C: RootComponent<{n: number}, {}, {GO: void}> = () => <p>timing</p>
C.initialState = {n: 0}
C.sinkState = mode
C.model = {GO: {
  STATE: s => ({n: s.n + 1}),
  EFFECT: (s, data, next, props) => {
    const current: number = props.state.n
    const previous: number = props.previousState.n
    // @ts-expect-error previousState retains the component state type
    const wrong: string = props.previousState.n
    void current; void previous; void wrong
  },
}}
run(C, {}, {sinkState: mode})
renderComponent(C, {sinkState: mode})
defineBehavior({sinkState: mode, initialState: {n: 0}})
// @ts-expect-error invalid mode
C.sinkState = 'later'
// @ts-expect-error invalid app default
run(C, {}, {sinkState: 'later'})
// @ts-expect-error invalid test default
renderComponent(C, {sinkState: 'later'})
// @ts-expect-error invalid behavior declaration
defineBehavior({sinkState: 'later', initialState: {}})
