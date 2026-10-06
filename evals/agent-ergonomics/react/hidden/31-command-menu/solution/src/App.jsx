import { useState } from 'react'
import { Command } from 'cmdk'
import { COMMANDS } from './commands.js'

// cmdk filters (and makes the first match active, with aria-activedescendant) itself; its default
// filter is fuzzy and sorts by score, so match plain substrings with equal scores (order kept).
const contains = (value, search) => (value.toLowerCase().includes(search.trim().toLowerCase()) ? 1 : 0)

export default function App() {
  const [lastCommand, setLastCommand] = useState(null)
  const [text, setText] = useState('')
  const [query, setQuery] = useState('')

  const run = (command) => {
    setLastCommand(command.label)
    setQuery('')
  }

  return (
    <main className="editor-page">
      <header>
        <h1>Untitled document</h1>
        <p className="last-command">{lastCommand ? `Ran: ${lastCommand}` : 'No command run yet.'}</p>
      </header>
      <section className="palette">
        <Command
          label="Search commands"
          filter={contains}
          loop
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault()
              setQuery('')
            }
          }}
        >
          <Command.Input value={query} onValueChange={setQuery} />
          <Command.List>
            <Command.Empty>No commands found.</Command.Empty>
            {COMMANDS.map((c) => (
              <Command.Item key={c.id} value={c.label} onSelect={() => run(c)}>
                {c.label}
              </Command.Item>
            ))}
          </Command.List>
        </Command>
      </section>
      <textarea className="document" aria-label="Document" value={text} onChange={(e) => setText(e.target.value)}></textarea>
    </main>
  )
}
