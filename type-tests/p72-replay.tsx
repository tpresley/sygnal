/**
 * 7.2 dev preview (record/replay): the handlers' now() / random() / uuid(), renderComponent's
 * options that fix them, sygnal/replay's recorder and replay(), Copy as test's replay mode.
 * Compiled by `npm run test:types`; never executed.
 */
import { describe, it, expectTypeOf } from 'vitest'
import { renderComponent, replay as replayMain } from 'sygnal'
import type { Component, HandlerEntropy, Recording as RecordingMain } from 'sygnal'
import { startRecording, replay, replayTest, bugReport, timeline, finalState, RECORDING_SCHEMA, inertDriver } from 'sygnal/replay'
import type { Recording, Recorder, ReplayResult, RecordedAction } from 'sygnal/replay'
import { copyAsTestResult } from 'sygnal/devtools'

type State = { tasks: Array<{ id: string; at: number; r: number }> }
type Actions = { ADD: string; LOG: undefined }

const Tasks: Component<State, {}, Actions> = ({ state }) => <ul>{state.tasks.map(t => <li>{t.id}</li>)}</ul>
Tasks.initialState = { tasks: [] }
Tasks.model = {
  ADD: (state, title, next, { now, random, uuid }) => {
    expectTypeOf(now).toEqualTypeOf<() => number>()
    expectTypeOf(uuid()).toEqualTypeOf<string>()
    return { tasks: [...state.tasks, { id: uuid(), at: now(), r: random() }] }
  },
  LOG: { EFFECT: (state, data, next, props) => { expectTypeOf(props.now()).toEqualTypeOf<number>() } },
}

// a prop of the same name wins (its type, not the function's)
type ClockProps = { now: number }
const Clock: Component<{ at: number }, ClockProps, { SET: undefined }> = ({ state }) => <i>{state.at}</i>
Clock.model = { SET: (state, data, next, props) => { expectTypeOf(props.now).toEqualTypeOf<number>(); return { at: props.now } } }

describe('renderComponent: now / random / uuid', () => {
  it('takes a fixed clock, a seed and deterministic ids, or functions', () => {
    renderComponent(Tasks, { now: 1_700_000_000_000, random: 42, uuid: true })
    renderComponent(Tasks, { now: new Date(), random: () => 0.5, uuid: () => 'id' })
    // @ts-expect-error a string clock
    renderComponent(Tasks, { now: '2026-01-01' })
    expectTypeOf<HandlerEntropy['random']>().toEqualTypeOf<() => number>()
  })
})

describe('sygnal/replay', () => {
  it('records, replays, writes tests and reports', async () => {
    const rec: Recorder = startRecording({ redact: { keep: ['VISIBILITY'] }, dropNoops: false, vnodes: 'html' })
    startRecording({ redact: false })
    // @ts-expect-error vnodes is 'hash' | 'html'
    startRecording({ vnodes: 'json' })
    const log = rec.stop()
    if (!log) return
    expectTypeOf(log).toEqualTypeOf<Recording>()
    expectTypeOf<RecordingMain>().toEqualTypeOf<Recording>()
    expectTypeOf(log.a).toEqualTypeOf<RecordedAction[]>()
    const r = await replay<State>(Tasks, log, { stopAt: 3, warn: false })
    expectTypeOf(r).toEqualTypeOf<ReplayResult<State>>()
    expectTypeOf(r.final.tasks).toEqualTypeOf<State['tasks']>()
    expectTypeOf(r.divergence?.diff).toEqualTypeOf<Array<{ path: string; expected: unknown; actual?: unknown; deleted?: true }> | undefined>()
    await replay(Tasks, JSON.stringify(log))
    expectTypeOf(replayMain).toEqualTypeOf(replay)
    expectTypeOf(replayTest(log, { componentImport: "import Tasks from './Tasks.jsx'" })).toEqualTypeOf<string>()
    expectTypeOf(bugReport(log, r, { expected: 'x' })).toEqualTypeOf<string>()
    expectTypeOf(timeline(log)).toEqualTypeOf<string[]>()
    expectTypeOf(finalState(log)).toEqualTypeOf<unknown>()
    expectTypeOf(RECORDING_SCHEMA).toMatchTypeOf<Record<string, unknown>>()
    replay(Tasks, log, { drivers: { DND: inertDriver() } })
    expectTypeOf(rec.test().file).toEqualTypeOf<string>()
  })

  it("Copy as test's replay mode", () => {
    const res = copyAsTestResult(undefined, { mode: 'replay', componentImport: "import App from './App.jsx'" })
    expectTypeOf(res.recording).toEqualTypeOf<string | undefined>()
    // @ts-expect-error 'steps' | 'replay'
    copyAsTestResult(undefined, { mode: 'record' })
  })
})
