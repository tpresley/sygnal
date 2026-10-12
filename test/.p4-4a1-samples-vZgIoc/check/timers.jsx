export function Clock({ state }) {
  return <p className="ticks">{state.ticks}</p>
}
Clock.initialState = { running: true, ticks: 0, last: null }
Clock.timers = (state) => ({ tick: state.running && { every: 1000, action: 'TICK' } })
Clock.model = {
  TICK: (state, data) => ({ ...state, ticks: state.ticks + 1, last: data }),
  STOP: (state) => ({ ...state, running: false }),
}
