// Spike 0-S1 probe: the rules whose node is wide, written the way real code is
// formatted (multi-line elements, objects, functions). The test fixtures are
// mostly one-liners, so they never show a multi-line range.
import { ABORT } from 'sygnal'

export function App({ state }) {
  return (
    <main>
      <img
        className="cover"
        src={state.cover}
      />
      <button
        type="button"
        className={state.starred ? 'star on' : 'star'}
      >
        Star
      </button>
      <button
        type="button"
        className="close"
      />
      <input
        type="text"
        className="search"
      />
      <ul className="list">{state.courses.length}</ul>
    </main>
  )
}
App.initialState = { courses: [], cover: '', starred: false }
App.intent = ({ DOM }) => ({
  STAR: DOM.click('.star'),
  LOAD: DOM.click('.list'),
  CLOSE: DOM.click('.close'),
  ASK: DOM.click('.cover'),
})
App.timers = (state) => ({
  tick: state.starred && {
    every: 0,
    action: 'TICK',
  },
  pulse: {
    every: 1000,
  },
})
App.model = {
  STAR: (state) => ({ ...state, starred: !state.starred }),
  LOAD: {
    HTTP: () => ({
      url: '/api/courses',
      ok: 'LOADED',
    }),
  },
  LOADED: (state, courses) => ({ ...state, courses }),
  CLOSE: (state) => {
    console.log('closing')
    return ABORT
  },
  ASK: {
    LLM: (state) => ({
      messages: state.messages,
      delta: 'DELTA',
    }),
  },
  DELTA: (state) => state,
  TICK: (state) => state,
}
