import Editor from './Editor.jsx'
import StatusBar from './StatusBar.jsx'

function App() {
  return (
    <div className="app">
      <h1>Notes</h1>
      <Editor state="editor" />
      <StatusBar state="status" />
    </div>
  )
}

App.initialState = {
  editor: { draft: '', saved: '' },
  status: { message: 'Ready' },
}

export default App
