import { Collection } from 'sygnal'

function Song({ state }) {
  return (
    <li className="song">
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
      <ul className="playlist" aria-label="Playlist">
        <Collection of={Song} from="songs" />
      </ul>
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

export default App
