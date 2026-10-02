export type CardData = {
  id: number
  title: string
  done: boolean
}

export type ListData = {
  id: string
  title: string
  cards: CardData[]
}
