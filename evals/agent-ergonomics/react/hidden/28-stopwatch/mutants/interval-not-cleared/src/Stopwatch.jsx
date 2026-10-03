import { useEffect, useState } from 'react'

const pad = (n) => String(n).padStart(2, '0')
function format(ms) {
  const tenths = Math.floor(ms / 100)
  return `${pad(Math.floor(tenths / 600))}:${pad(Math.floor(tenths / 10) % 60)}.${tenths % 10}`
}

const INITIAL = { status: 'idle', accumulated: 0, startedAt: 0, now: 0, lastLapAt: 0, laps: [] }

// Running time at clock time `at`: the finished segments plus the current one.
const elapsedAt = (s, at) => s.accumulated + (s.status === 'running' ? at - s.startedAt : 0)

export default function Stopwatch() {
  const [s, setS] = useState(INITIAL)
  const running = s.status === 'running'

  useEffect(() => {
    if (!running) return undefined
    // MUTANT: the interval is never cleared
    setInterval(() => setS((prev) => ({ ...prev, now: Date.now() })), 100)
    return undefined
  }, [running])

  const toggle = () => {
    const at = Date.now()
    setS((prev) =>
      prev.status === 'running'
        ? { ...prev, status: 'paused', accumulated: elapsedAt(prev, at), now: at }
        : { ...prev, status: 'running', startedAt: at, now: at }
    )
  }
  const lap = () => {
    const at = Date.now()
    setS((prev) => {
      const total = elapsedAt(prev, at)
      return { ...prev, now: at, laps: [...prev.laps, total - prev.lastLapAt], lastLapAt: total }
    })
  }

  const label = running ? 'Pause' : s.status === 'paused' ? 'Resume' : 'Start'
  return (
    <section className="stopwatch">
      <p className="time">{format(elapsedAt(s, s.now))}</p>
      <div className="controls">
        <button className="toggle" onClick={toggle}>
          {label}
        </button>
        <button className="lap" disabled={!running} onClick={lap}>
          Lap
        </button>
        <button className="reset" disabled={s.status !== 'paused'} onClick={() => setS(INITIAL)}>
          Reset
        </button>
      </div>
      <ol className="laps">
        {s.laps.map((ms, i) => (
          <li key={i}>{`Lap ${i + 1}: ${format(ms)}`}</li>
        ))}
      </ol>
    </section>
  )
}
