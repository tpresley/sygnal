export type TaskState = {
  id: number
  title: string
  assignee: string
  done: boolean
}

export type ProjectState = {
  id: string
  name: string
  tasks: TaskState[]
}

export type FiltersState = {
  hideDone: boolean
}

export type AppState = {
  filters: FiltersState
  selectedTaskId: number | null
  projects: ProjectState[]
}

export type AppCalculated = {
  openCount: number
}

export type SelectedTask = TaskState & { projectName: string }

/** Values the App shares with every component below it (`App.context`). */
export type AppContext = {
  hideDone: boolean
  selectedTask: SelectedTask | null
  selectedTaskId: number | null
}
