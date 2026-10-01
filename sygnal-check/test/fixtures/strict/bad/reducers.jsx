// SYG502 (no-op without ABORT) and SYG503 (side effect + ABORT in STATE).
import { ABORT, createCommand } from 'sygnal'

const player = createCommand()

function Player({ state }) {
  return (
    <div className="player">
      <button className="save">save</button>
      <button className="reset">reset</button>
      <button className="maybe">maybe</button>
      <button className="mutate">mutate</button>
      <button className="play">play</button>
      <button className="log">log</button>
      <span>{state.title}</span>
    </div>
  )
}

Player.initialState = { title: '', saved: false }

Player.intent = ({ DOM }) => ({
  SAVE: DOM.click('.save'),
  RESET: DOM.click('.reset'),
  MAYBE: DOM.click('.maybe'),
  MUTATE: DOM.click('.mutate'),
  PLAY: DOM.click('.play'),
  LOG: DOM.click('.log'),
})

function mutate(state) {
  state.saved = true
} // expect: SYG502

Player.model = {
  SAVE: (state) => state.title ? { ...state, saved: true } : state, // expect: SYG502
  RESET: (state) => {
    if (!state.saved) return // expect: SYG502
    return { ...state, saved: false }
  },
  MAYBE: (state, data) => {
    if (data) {
      return { ...state, title: data }
    }
  }, // expect: SYG502
  MUTATE: mutate,
  PLAY: (state) => {
    player.send('play') // expect: SYG503
    return ABORT
  },
  LOG: {
    STATE: (state, data) => {
      console.log('LOG', data) // expect: SYG503
      if (!data) return ABORT
      return { ...state, title: data }
    },
  },
}

export default Player
