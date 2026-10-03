import { xs, dropRepeats } from 'sygnal'

export const INITIAL = { status: 'idle', accumulated: 0, startedAt: 0, now: 0, lastLapAt: 0, laps: [] }

const pad = (n) => String(n).padStart(2, '0')
export function format(ms) {
  const tenths = Math.floor(ms / 100)
  return `${pad(Math.floor(tenths / 600))}:${pad(Math.floor(tenths / 10) % 60)}.${tenths % 10}`
}

// Running time at clock time `at`: the finished segments plus the current one.
const elapsedAt = (state, at) => state.accumulated + (state.status === 'running' ? at - state.startedAt : 0)

function Stopwatch({ state }) {
  const label = state.status === 'running' ? 'Pause' : state.status === 'paused' ? 'Resume' : 'Start'
  return (
    <section className="stopwatch">
      <p className="time">{format(elapsedAt(state, state.now))}</p>
      <div className="controls">
        <button className="toggle">{label}</button>
        <button className="lap" disabled={state.status !== 'running'}>
          Lap
        </button>
        <button className="reset" disabled={state.status !== 'paused'}>
          Reset
        </button>
      </div>
      <ol className="laps">
        {state.laps.map((lap, i) => (
          <li>{`Lap ${i + 1}: ${format(lap)}`}</li>
        ))}
      </ol>
    </section>
  )
}

const clock = () => Date.now()

Stopwatch.intent = ({ DOM, STATE }) => ({
  TOGGLE: DOM.click('.toggle').map(clock),
  LAP: DOM.click('.lap').map(clock),
  RESET: DOM.click('.reset'),
  // A 100 ms tick only while running: switching to xs.empty() stops the interval,
  // and unmounting the component tears the whole chain down.
  TICK: STATE.stream
    .map((state) => state.status === 'running')
    .compose(dropRepeats())
    .map((running) => (running ? xs.periodic(100) : xs.empty()))
    .flatten()
    .map(clock),
})

Stopwatch.model = {
  TOGGLE: (state, at) =>
    state.status === 'running'
      ? { ...state, status: 'paused', accumulated: elapsedAt(state, at), now: at }
      : { ...state, status: 'running', startedAt: at, now: at },
  TICK: (state, at) => ({ ...state, now: at }),
  LAP: (state, at) => {
    const total = elapsedAt(state, at)
    // MUTANT: a lap shows the total running time, not the lap's own
    return { ...state, now: at, laps: [...state.laps, total], lastLapAt: total }
  },
  RESET: () => INITIAL,
}

export default Stopwatch
