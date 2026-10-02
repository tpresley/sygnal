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
