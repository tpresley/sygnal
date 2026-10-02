import type { Component } from 'sygnal'
import Editor from './Editor'
import StatusBar from './StatusBar'
import type { AppState } from './types'

const App: Component<AppState> = () => (
  <div className="app">
    <h1>Notes</h1>
    <Editor state="editor" />
    <StatusBar state="status" />
  </div>
)

App.initialState = {
  editor: { draft: '', saved: '' },
  status: { message: 'Ready' },
}

export default App
