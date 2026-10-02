export type EditorState = {
  draft: string
  saved: string
}

export type StatusState = {
  message: string
}

export type AppState = {
  editor: EditorState
  status: StatusState
}
