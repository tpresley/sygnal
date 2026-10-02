export type TaskData = {
  id: number
  title: string
  assignee: string
  done: boolean
}

export type ProjectData = {
  id: string
  name: string
  tasks: TaskData[]
}
