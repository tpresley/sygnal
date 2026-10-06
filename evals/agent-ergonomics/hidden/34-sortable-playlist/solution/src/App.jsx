import { Collection, sortable } from 'sygnal'

function Song({ state, context }) {
  const { dragging, helpId } = context.sort
  const id = String(state.id)
  return (
    <li className={dragging === id ? 'song dragging' : 'song'} data-id={state.id}>
      <button type="button" className="grip" aria-label={`Reorder ${state.title}`} aria-describedby={helpId} aria-pressed={String(dragging === id)}>⠿</button>
      <span className="title">{state.title}</span>
      <label className="favorite">
        <input type="checkbox" aria-label={`Favorite ${state.title}`} checked={state.favorite} /> Favorite
      </label>
    </li>
  )
}

Song.intent = ({ DOM }) => ({ FAVORITE: DOM.change('.favorite input').checked() })
Song.model = { FAVORITE: (state, favorite) => ({ ...state, favorite }) }

function App({ state }) {
  return (
    <main className="player">
      <h1>Road trip</h1>
      <p id={state.sort.helpId} className="help" hidden>
        Press Space or Enter to pick up a song, the arrow keys to move it, Space or Enter to drop it, and Escape to cancel.
      </p>
      <ul className="playlist" aria-label="Playlist">
        <Collection of={Song} from="songs" />
      </ul>
      <p className="announcer" role="status" aria-live="assertive">{state.sort.message}</p>
    </main>
  )
}

App.initialState = {
  songs: [
    { id: 1, title: 'Yesterday', favorite: false },
    { id: 2, title: 'Blackbird', favorite: false },
    { id: 3, title: 'Something', favorite: false },
    { id: 4, title: 'Penny Lane', favorite: false },
    { id: 5, title: 'Help!', favorite: false },
  ],
}

App.uses = {
  sort: sortable({
    from: 'songs',
    item: '.song',
    handle: '.grip',
    messages: {
      lift: (title, n, count) => `Picked up ${title}, position ${n} of ${count}.`,
      move: (title, n, count) => `Moved ${title} to position ${n} of ${count}.`,
      drop: (title, n, count) => `Dropped ${title} at position ${n} of ${count}.`,
      cancel: (title, n, count) => `Cancelled. ${title} is back at position ${n} of ${count}.`,
      stay: (title, n, count) => `Cancelled. ${title} stays at position ${n} of ${count}.`,
    },
  }),
}

App.context = { sort: (state) => state.sort }

export default App
