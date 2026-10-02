export type CardState = {
  id: number
  title: string
  done: boolean
}

export type ListState = {
  id: string
  title: string
  cards: CardState[]
}

export type AppState = {
  lists: ListState[]
}

/** A card asks its list to move it one list left (-1) or right (+1). */
export type CardMove = { cardId: number; offset: -1 | 1 }

/** The list adds which list the card is in and passes the request to the board. */
export type ListMove = CardMove & { listId: string }
