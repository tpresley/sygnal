import { run, persist, undo, makeTimerDriver } from 'sygnal'
import { nudge } from './nudge.js'

export function Mixer({ state }) {
  return (
    <section>
      <div className="row">
        <div className={state.knob.active ? 'knob active' : 'knob'} role="slider" tabIndex={0} aria-label="Volume"
          aria-valuemin={0} aria-valuemax={100} aria-valuenow={state.volume}>
          <span style={{ width: `${state.volume}%` }} />
        </div>
        <strong>{state.volume}</strong>
      </div>
      <div className="row">
        <button className="undo" disabled={!state.history.canUndo}>Undo</button>
        <button className="redo" disabled={!state.history.canRedo}>Redo</button>
        <span className="muted">{state.history.past.length} undo steps</span>
      </div>
      <p className="status">
        {state.knob.active ? `Nudging (from ${state.knob.start}): Enter keeps it, Escape puts it back, 3 s idle keeps it` : 'Focus the bar and press Up / Down'}
      </p>
      <p className="muted">Reload the page: the volume comes back (persist), a gesture in progress doesn't (persist: false).</p>
    </section>
  )
}

Mixer.initialState = { volume: 50 }
Mixer.uses = {
  knob: nudge({ from: 'volume', knob: '.knob' }),
  history: undo({ key: 'volume', undo: '.undo', redo: '.redo' }),
}
// no pick: every key is saved, except slices of behaviors marked persist: false
Mixer.persist = persist({ key: 'p5-showcase-mixer' })

export const start = (mountPoint, uid) => run(Mixer, { TIMER: makeTimerDriver() }, { mountPoint, uid })
