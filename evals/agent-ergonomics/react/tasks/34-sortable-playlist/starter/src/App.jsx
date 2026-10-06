import { useState } from 'react'

const SONGS = [
  { id: 1, title: 'Yesterday', favorite: false },
  { id: 2, title: 'Blackbird', favorite: false },
  { id: 3, title: 'Something', favorite: false },
  { id: 4, title: 'Penny Lane', favorite: false },
  { id: 5, title: 'Help!', favorite: false },
]

function Song({ song, onFavorite }) {
  return (
    <li className="song">
      <span className="title">{song.title}</span>
      <label className="favorite">
        <input type="checkbox" aria-label={`Favorite ${song.title}`} checked={song.favorite} onChange={(e) => onFavorite(song.id, e.target.checked)} /> Favorite
      </label>
    </li>
  )
}

export default function App() {
  const [songs, setSongs] = useState(SONGS)
  const favorite = (id, value) => setSongs((list) => list.map((s) => (s.id === id ? { ...s, favorite: value } : s)))

  return (
    <main className="player">
      <h1>Road trip</h1>
      <ul className="playlist" aria-label="Playlist">
        {songs.map((song) => (
          <Song key={song.id} song={song} onFavorite={favorite} />
        ))}
      </ul>
    </main>
  )
}
