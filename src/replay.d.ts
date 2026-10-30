// Types for 'sygnal/replay' (7.2 dev preview). The implementation lives in src/extra/replay/;
// the main entry re-exports these (replay() sits next to renderComponent).
import type { RenderResult } from 'sygnal'

/** An action's cause in a recording: inputs i intent, r reply, n next, a simulateAction, B behavior, g agent, S setState; consequences b built-in, p parent */
export type RecordedCause = 'i' | 'r' | 'n' | 'a' | 'B' | 'g' | 'S' | 'b' | 'p'

/** One action of a recording (RECORDING_SCHEMA has the details) */
export interface RecordedAction {
  /** sequence number */
  s: number
  /** ms since the previous action kept (at enqueue) */
  t: number
  /** index into the recording's addresses (`p`) */
  p: number
  /** the action type */
  y: string
  c: RecordedCause
  /** a reply's source (driver name) */
  r?: string
  /** the data (inputs only; events and elements as stubs) */
  d?: unknown
  /** the clock and randomness its handlers read, in order: ['now' | 'random' | 'uuid' | 'perf', value] */
  e?: Array<[string, unknown]>
  /** hash of the instance's new state, when its STATE changed */
  h?: string
  /** [sink, hash] of the values its other sinks produced */
  f?: Array<[string, string]>
}

/** A recording, format version 1: plain JSON (save it with JSON.stringify) */
export interface Recording {
  kind: 'sygnal-recording'
  version: 1
  /** the Sygnal version that recorded it (a replay on another version warns) */
  sygnal: string
  /** the root component's name */
  app: string
  /** ISO time the recording started */
  recorded: string
  /** typed text, server data and setState values pseudonymized; checkpoints masked */
  redacted: boolean
  /** component name -> the action names its model handled (a replay against code without one warns) */
  components: Record<string, string[]>
  /** the app's own sources: 'resources' (makeFetchDriver), 'timers' (makeTimerDriver), 'other' (an inert driver in the replay) */
  sources: Record<string, 'resources' | 'timers' | 'other'>
  /** the root state when the app started */
  init: unknown
  /** instance addresses: `App`, `App/Lane[lane-2]` (a Collection item), `App/Header:0` */
  p: string[]
  a: RecordedAction[]
  /** checkpoints, one per patch: the last action's sequence number, the view's hash, the root state's diff */
  k: Array<{ s: number; v: string; o?: unknown[]; html?: string }>
  /** declaration statics sent to drivers: [seq, sink, hash] */
  fx: Array<[number, string, string]>
  end?: { s: number; ms: number; dropped: number; o?: unknown[] }
}

export interface RecordOptions {
  /**
   * Default true. `true` or `{ keep, also }`: the strings of typed input (intent actions
   * dispatched while a text-entry DOM event was delivered, and later actions of those types),
   * server replies, setState values and the types in `also` are pseudonymized (same shape, equal
   * strings stay equal); never the types in `keep`, nor next() data. Checkpoints are masked.
   * A redacted string the model branches on makes the replay diverge there: add it to `keep`.
   * `false`: nothing redacted.
   */
  redact?: boolean | { keep?: string[]; also?: string[] }
  /** Default true: leave out inputs that changed nothing (an idle timer's ticks) */
  dropNoops?: boolean
  /** 'hash' (default), or 'html': checkpoints also keep the view's markup (for reports) */
  vnodes?: 'hash' | 'html'
}

export interface Recorder {
  /** stop recording; the recording (undefined when no app started) */
  stop(): Recording | undefined
  /** the recording so far (the recording goes on) */
  log(): Recording | undefined
  /** an app is being recorded */
  active(): boolean
  /** a replay test for the recording so far: the test file, the recording's JSON and its file name */
  test(options?: ReplayTestOptions): { code: string; recording: string; file: string }
}

/**
 * Record the next app started (run() or renderComponent()) as a log of its input actions, the
 * clock and randomness its handlers read, and a checkpoint per patch. Dev only: an app that never
 * imports 'sygnal/replay' pays nothing.
 */
export function startRecording(options?: RecordOptions): Recorder

export interface ReplayOptions {
  /** drivers to use instead of the inert ones (by source name) */
  drivers?: Record<string, any>
  /** more renderComponent options */
  render?: Record<string, any>
  /** stop after this many checkpoints */
  stopAt?: number
  /** false: handlers read the real clock and randomness */
  entropy?: boolean
  /** false: no console.warn for version / name mismatches (they are in `warnings`) */
  warn?: boolean
}

/** Where a replay first differs from the recording */
export interface ReplayDivergence {
  s: number
  type?: string
  /** the instance's address */
  path?: string
  cause?: string
  data?: unknown
  reason: string
  /** the checkpoint whose root state differs */
  checkpoint?: number | 'end'
  /** the root state's differences at that checkpoint: recorded (expected) vs now (actual) */
  diff?: Array<{ path: string; expected: unknown; actual?: unknown; deleted?: true }>
}

export interface ReplayResult<STATE = any> {
  /** no divergence, view change, effect change, unresolved input or unhandled action */
  ok: boolean
  divergence: ReplayDivergence | null
  /** the first checkpoint whose view differs while the state matches (a view-only change) */
  view: { checkpoint: number; s: number; expected: string; actual: string; html: string; expectedHtml?: string } | null
  /** actions whose sink values (requests, EVENTS, ...) differ: hashes, and the values sent now */
  effects: Array<{ s: number; type: string; path: string; expected: Array<[string, string]>; actual: Array<[string, string]>; values: Array<[string, unknown]> }>
  /** action types the code no longer handles */
  unhandled: string[]
  /** inputs whose instance never appeared */
  unresolved: Array<{ s: number; type: string; path: string }>
  /** recorded actions that didn't run, and actions that ran but weren't recorded */
  missing: Array<{ s: number; type: string; path: string }>
  extra: Array<{ type: string; path: string; cause: string }>
  /** clock / randomness reads the replay had no recorded value for */
  misses: string[]
  /** Sygnal version, component or action names that differ from the recording's */
  warnings: string[]
  checkpoints: number
  actions: number
  /** the final root state */
  final: STATE
  /** the renderComponent handle (dispose it) */
  t: RenderResult<STATE>
}

/**
 * Replay a recording (the object, or its JSON) on `Component` in renderComponent: the recorded
 * inputs go to the same instances in the same order, every handler gets the clock and randomness
 * it read, and each action and checkpoint is compared with the recording.
 */
export function replay<STATE = any>(Component: any, recording: Recording | string, options?: ReplayOptions): Promise<ReplayResult<STATE>>

export interface ReplayTestOptions {
  /** the import line for the component (default `import <App> from './<App>.js'`) */
  componentImport?: string
  componentName?: string
  /** the recording's path relative to the test (default `./<App>.recording.json`) */
  logFile?: string
  /** default 'sygnal/replay' */
  replayImport?: string
  /** more replay() options as source code: "drivers: { DND: myDriver }" */
  replayOptions?: string
  testName?: string
  environment?: string
}

/** A Vitest file that replays the recording and asserts no divergence and the final state */
export function replayTest(recording: Recording, options?: ReplayTestOptions): string

/** Markdown for a bug report: the timeline, what the replay found, how to reproduce */
export function bugReport(recording: Recording, result?: ReplayResult, options?: { title?: string; logName?: string; expected?: string }): string

/** One line per recorded input: time, instance, type, cause, data */
export function timeline(recording: Recording, options?: { max?: number }): string[]

/** The final root state the recording holds */
export function finalState(recording: Recording): unknown

/** The recording format (version 1) as a JSON Schema */
export const RECORDING_SCHEMA: Record<string, unknown>

/** A driver whose source accepts any call chain and never emits (a replay's stand-in for a recorded app's own drivers) */
export function inertDriver(): (sink$: any) => any
