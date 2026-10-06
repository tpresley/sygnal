import { useState } from 'react'
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors } from '@dnd-kit/core'
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

const SONGS = [
  { id: 1, title: 'Yesterday', favorite: false },
  { id: 2, title: 'Blackbird', favorite: false },
  { id: 3, title: 'Something', favorite: false },
  { id: 4, title: 'Penny Lane', favorite: false },
  { id: 5, title: 'Help!', favorite: false },
]

function Song({ song, onFavorite }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: song.id })
  return (
    <li ref={setNodeRef} className={isDragging ? 'song dragging' : 'song'} style={{ transform: CSS.Transform.toString(transform), transition }}>
      <button type="button" className="grip" ref={setActivatorNodeRef} {...attributes} {...listeners} aria-label={`Reorder ${song.title}`}>⠿</button>
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
  const sensors = useSensors(useSensor(PointerSensor), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }))

  const titleOf = (id) => songs.find((s) => s.id === id)?.title
  const positionOf = (id) => songs.findIndex((s) => s.id === id) + 1
  const announcements = {
    onDragStart: ({ active }) => `Picked up ${titleOf(active.id)}, position ${positionOf(active.id)} of ${songs.length}.`,
    onDragOver: ({ active, over }) => (over ? `Moved ${titleOf(active.id)} to position ${positionOf(over.id)} of ${songs.length}.` : undefined),
    onDragEnd: ({ active, over }) =>
      over ? `Dropped ${titleOf(active.id)} at position ${positionOf(over.id)} of ${songs.length}.` : `Cancelled. ${titleOf(active.id)} is back at position ${positionOf(active.id)} of ${songs.length}.`,
    onDragCancel: ({ active }) => `Cancelled. ${titleOf(active.id)} is back at position ${positionOf(active.id)} of ${songs.length}.`,
  }

  const onDragEnd = ({ active, over }) => {
    if (over && active.id !== over.id) {
      setSongs((list) => arrayMove(list, list.findIndex((s) => s.id === active.id), list.findIndex((s) => s.id === over.id)))
    }
  }

  return (
    <main className="player">
      <h1>Road trip</h1>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={onDragEnd}
        accessibility={{
          announcements,
          screenReaderInstructions: {
            draggable: 'Press Space or Enter to pick up a song, the arrow keys to move it, Space or Enter to drop it, and Escape to cancel.',
          },
        }}
      >
        <SortableContext items={songs.map((s) => s.id)} strategy={verticalListSortingStrategy}>
          <ul className="playlist" aria-label="Playlist">
            {songs.map((song) => (
              <Song key={song.id} song={song} onFavorite={favorite} />
            ))}
          </ul>
        </SortableContext>
      </DndContext>
    </main>
  )
}
