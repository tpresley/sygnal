// PLAN-4 3-C (GS-7): the `timers` static (typed from STATE & CALCULATED; the action names from
// ACTIONS when the component names them), makeTimerDriver(), the action data types, t.timers().
import { makeTimerDriver, renderComponent, run } from 'sygnal'
import type { Component, RootComponent, TimerSpec, Timers, TimerTick, TimerAfter, TimerFrame, ActiveTimer } from 'sygnal'

type WatchState = { running: boolean; armed: boolean; animating: boolean; now: number; frames: number }
type WatchActions = { START: null; TICK: TimerTick; EXPIRE: TimerAfter; FRAME: TimerFrame }

export const Watch: RootComponent<WatchState, {}, WatchActions> = ({ state }) => <p>{state.now}</p>
Watch.initialState = { running: false, armed: false, animating: false, now: 0, frames: 0 }
Watch.timers = (state) => ({
  tick: state.running && { every: 100, action: 'TICK' },
  done: state.armed && { after: 5000, action: 'EXPIRE', background: true },
  frame: state.animating && { frame: 'FRAME' },
  off: null,
  gone: undefined,
})
Watch.model = {
  START: (state) => ({ ...state, running: true }),
  TICK: (state, { n, t }) => ({ ...state, now: t + n * 0 }),
  EXPIRE: (state, { t }) => ({ ...state, armed: false, now: t }),
  FRAME: (state, { t, dt }) => ({ ...state, frames: state.frames + 1, now: t + dt * 0 }),
}

// action names come from ACTIONS
// @ts-expect-error no such action
Watch.timers = (state) => ({ tick: state.running && { every: 100, action: 'TOCK' } })
// @ts-expect-error no such action (frame)
Watch.timers = () => ({ frame: { frame: 'FRAMES' } })
// the state parameter is typed
// @ts-expect-error no such state key
Watch.timers = (state) => ({ tick: state.missing && { every: 100, action: 'TICK' } })
// @ts-expect-error every is a number of ms
Watch.timers = () => ({ tick: { every: '100', action: 'TICK' } })
// @ts-expect-error a spec needs every, after or frame
Watch.timers = () => ({ tick: { action: 'TICK' } })
// @ts-expect-error every and after don't mix
Watch.timers = () => ({ tick: { every: 100, after: 5, action: 'TICK' } })
// @ts-expect-error a timer action's data is TimerTick ({ n, t })
const _bad: TimerTick = { n: 1 }

// without ACTIONS any action name goes
export const Loose: Component<{ on: boolean }> = () => <p>x</p>
Loose.timers = (state) => ({ x: state.on && { every: 10, action: 'ANY' } })

// the exported helper types
const spec: TimerSpec<'A'> = { after: 0, action: 'A' }
const set: Timers = { a: spec, b: false, c: { frame: 'F', background: true } }
void set

// the driver: any key, conventionally TIMER
const driver: (sink$: any) => { dispose(): void } = makeTimerDriver()
run(Watch, { TIMER: driver })
// @ts-expect-error makeTimerDriver takes no options
makeTimerDriver({ every: 1 })

// t.timers() and the timerSink option
const t = renderComponent(Watch, { timerSink: 'TIMER' })
const active: ActiveTimer[] = t.timers()
const first = active[0]
const fields: [string, string, string] = [first.name, first.action, first.component]
void fields
if (first.every !== undefined) { const ms: number = first.every; void ms }
// @ts-expect-error t.timers takes no arguments
t.timers('TIMER')
