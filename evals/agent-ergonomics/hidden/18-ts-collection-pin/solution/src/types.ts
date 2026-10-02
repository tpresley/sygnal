export type Task = {
  id: number
  title: string
  done: boolean
}

export type AppState = {
  tasks: Task[]
  pinnedId: number | null
}
