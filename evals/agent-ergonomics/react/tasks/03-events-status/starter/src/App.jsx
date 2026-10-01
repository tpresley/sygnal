import Editor from './Editor.jsx'
import StatusBar from './StatusBar.jsx'

export default function App() {
  return (
    <div className="app">
      <h1>Notes</h1>
      <Editor />
      <StatusBar message="Ready" />
    </div>
  )
}
