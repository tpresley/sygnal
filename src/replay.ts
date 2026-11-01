// 'sygnal/replay' (7.2 dev preview): record a session, replay it as a test, report divergences.
// The code lives in the main package (src/extra/replay/), and this entry re-exports it from the
// external 'sygnal' (rollup maps './index' to it), as 'sygnal/ai' and 'sygnal/api' do: one copy
// per app. replay() is also on the main entry, next to renderComponent.
// Keep this list in sync with src/index.ts and src/replay.d.ts.
export {startRecording, replay, replayTest, bugReport, timeline, finalState, RECORDING_SCHEMA, inertDriver} from './index'
