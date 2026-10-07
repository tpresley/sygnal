import { run, Collection } from 'sygnal'

// views may return a string or a number: rendered as text, on the client as on the server
function Greeting({ state }) {
  return `Hello, ${state.name}!`
}
function Total({ state }) {
  return state.players.reduce((sum, p) => sum + p.points, 0)
}
function Score({ state }) {
  return `${state.name} ${state.points} · `
}

export function Scoreboard({ state }) {
  return (
    <div>
      <p className="lead"><Greeting state="host" /></p>
      <p>Total points: <strong><Total /></strong></p>
      <p>Scores: <Collection of={Score} from="players" /></p>
      <div className="row">
        <button className="point">Ada scores</button>
        <button className="rename">Rename the host</button>
      </div>
    </div>
  )
}

Scoreboard.initialState = {
  host: { name: 'Grace' },
  players: [{ id: 1, name: 'Ada', points: 3 }, { id: 2, name: 'Alan', points: 5 }],
}
Scoreboard.intent = ({ DOM }) => ({ POINT: DOM.click('.point'), RENAME: DOM.click('.rename') })
Scoreboard.model = {
  POINT: (state) => ({ ...state, players: state.players.map((p) => (p.id === 1 ? { ...p, points: p.points + 1 } : p)) }),
  RENAME: (state) => ({ ...state, host: { name: state.host.name === 'Grace' ? 'Margaret' : 'Grace' } }),
}

export const start = (mountPoint, uid) => run(Scoreboard, {}, { mountPoint, uid })
