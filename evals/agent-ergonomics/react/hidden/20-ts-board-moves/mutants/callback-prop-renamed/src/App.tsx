import { useState } from 'react'
import List from './List'
import type { CardData, ListData } from './types'

const initialLists: ListData[] = [
  {
    id: 'todo',
    title: 'To do',
    cards: [
      { id: 1, title: 'Write spec', done: false },
      { id: 2, title: 'Design schema', done: false },
      { id: 3, title: 'Set up CI', done: true },
    ],
  },
  {
    id: 'doing',
    title: 'Doing',
    cards: [{ id: 4, title: 'Build API', done: false }],
  },
  {
    id: 'done',
    title: 'Done',
    cards: [{ id: 5, title: 'Kickoff meeting', done: true }],
  },
]

export default function App() {
  const [lists, setLists] = useState<ListData[]>(initialLists)
  const totalCards = lists.reduce((sum, list) => sum + list.cards.length, 0)

  const updateCards = (listId: string, update: (cards: CardData[]) => CardData[]) =>
    setLists((current) => current.map((list) => (list.id === listId ? { ...list, cards: update(list.cards) } : list)))

  const toggleCard = (listId: string, cardId: number) =>
    updateCards(listId, (cards) => cards.map((card) => (card.id === cardId ? { ...card, done: !card.done } : card)))

  const deleteCard = (listId: string, cardId: number) =>
    updateCards(listId, (cards) => cards.filter((card) => card.id !== cardId))

  const moveCard = (listId: string, cardId: number, offset: -1 | 1) =>
    setLists((current) => {
      const from = current.findIndex((list) => list.id === listId)
      const to = from + offset
      if (from < 0 || to < 0 || to >= current.length) return current
      const card = current[from].cards.find((c) => c.id === cardId)
      if (!card) return current
      return current.map((list, i) => {
        if (i === from) return { ...list, cards: list.cards.filter((c) => c.id !== cardId) }
        if (i === to) return { ...list, cards: [...list.cards, card] }
        return list
      })
    })

  return (
    <div className="board">
      <header className="board-header">
        <h1>Project board</h1>
        <p className="total">Cards: {totalCards}</p>
      </header>
      <div className="lists">
        {lists.map((list) => (
          <List
            key={list.id}
            list={list}
            onToggle={(cardId) => toggleCard(list.id, cardId)}
            onDelete={(cardId) => deleteCard(list.id, cardId)}
            onMoveCard={(cardId: number, offset: -1 | 1) => moveCard(list.id, cardId, offset)}
          />
        ))}
      </div>
    </div>
  )
}
