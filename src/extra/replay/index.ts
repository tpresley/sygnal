// sygnal/replay (7.2 dev preview; research and decisions: dev-plans/research/record-replay):
// record a session as a log of input actions, replay it in renderComponent and report where the
// code now diverges. Exported from the main bundle (tree-shaken) and re-exported by src/replay.ts.
export {startRecording} from './recorder'
export {replay} from './replayer'
export {replayTest, bugReport, timeline, finalState} from './report'
export {RECORDING_SCHEMA} from './schema'
export {inertDriver} from './inert'
