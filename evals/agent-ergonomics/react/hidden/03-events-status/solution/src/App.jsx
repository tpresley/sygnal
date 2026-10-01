import { useState } from 'react'
import Editor from './Editor.jsx'
import StatusBar from './StatusBar.jsx'

const countWords = (text) => text.split(/\s+/).filter(Boolean).length

export default function App() {
  const [message, setMessage] = useState('Ready')

  const onEdit = () => setMessage('Unsaved changes')
  const onSave = (text) => {
    const words = countWords(text)
    setMessage(`Saved ${words} ${words === 1 ? 'word' : 'words'}`)
  }

  return (
    <div className="app">
      <h1>Notes</h1>
      <Editor onEdit={onEdit} onSave={onSave} />
      <StatusBar message={message} />
    </div>
  )
}
