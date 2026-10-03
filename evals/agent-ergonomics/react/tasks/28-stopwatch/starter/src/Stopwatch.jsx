export default function Stopwatch() {
  return (
    <section className="stopwatch">
      <p className="time">00:00.0</p>
      <div className="controls">
        <button className="toggle">Start</button>
        <button className="lap" disabled>
          Lap
        </button>
        <button className="reset" disabled>
          Reset
        </button>
      </div>
      <ol className="laps"></ol>
    </section>
  )
}
