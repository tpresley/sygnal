import Editor from './Editor'
import StatusBar from './StatusBar'

export default function App() {
  return (
    <div className="app">
      <h1>Notes</h1>
      <Editor />
      <StatusBar message="Ready" />
    </div>
  )
}
