import { useState } from 'react'
import Editor from './Editor'
import StatusBar from './StatusBar'

const countWords = (text: string) => text.split(/\s+/).filter(Boolean).length

export default function App() {
  const [message, setMessage] = useState('Ready')

  const onEdit = () => setMessage('Unsaved changes')
  const onSave = (text: string) => {
    const words = countWords(text)
    setMessage(`Saved ${words} ${words === 1 ? 'word' : 'words'}`)
  }

  return (
    <div className="app">
      <h1>Notes</h1>
      <Editor onEdit={onEdit} onSaved={onSave} />
      <StatusBar message={message} />
    </div>
  )
}
