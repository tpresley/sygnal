import { useEffect, useMemo, useState } from 'react'
import { closeTicket, getTickets, postReply } from './api.js'
import { canSend } from './rules.js'
import TicketDetail from './TicketDetail.jsx'
import TicketList from './TicketList.jsx'

export default function App() {
  const [tickets, setTickets] = useState([])
  const [folder, setFolder] = useState('open')
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState(null)
  const [drafts, setDrafts] = useState({})
  const [notice, setNotice] = useState(null)

  useEffect(() => {
    let cancelled = false
    getTickets()
      .then((list) => { if (!cancelled) setTickets(list) })
      .catch(() => { if (!cancelled) setNotice('Could not load tickets.') })
    return () => { cancelled = true }
  }, [])

  const visible = useMemo(
    () => tickets.filter(
      (t) => t.status === folder && t.subject.toLowerCase().includes(query.toLowerCase()),
    ),
    [tickets, folder, query],
  )
  const openCount = tickets.filter((t) => t.status === 'open').length
  const selected = tickets.find((t) => t.id === selectedId) ?? null
  const draft = drafts[selectedId] ?? ''

  function handlePickFolder(next) {
    setFolder(next)
    setSelectedId(null)
  }

  function handleSelect(id) {
    setSelectedId(id)
    setNotice(null)
  }

  function handleDraft(text) {
    setDrafts((d) => ({ ...d, [selectedId]: text }))
  }

  async function handleSend() {
    if (!canSend(selected, draft)) return
    try {
      await postReply(selectedId, draft)
      setDrafts((d) => ({ ...d, [selectedId]: '' }))
      setNotice('Reply sent.')
    } catch {
      setNotice('That did not go through.')
    }
  }

  async function handleClose() {
    if (draft.trim()) {
      setNotice('Send or discard your reply first.')
      return
    }
    try {
      const updated = await closeTicket(selectedId)
      setTickets((list) => list.map((t) => (t.id === updated.id ? updated : t)))
      setSelectedId(null)
      setNotice('Ticket closed.')
    } catch {
      setNotice('That did not go through.')
    }
  }

  return (
    <main className="inbox">
      <nav>
        <button className="folder" data-folder="open" onClick={() => handlePickFolder('open')}>Open ({openCount})</button>
        <button className="folder" data-folder="closed" onClick={() => handlePickFolder('closed')}>Closed</button>
      </nav>
      <input
        className="search"
        aria-label="Search tickets"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <TicketList tickets={visible} onSelect={handleSelect} />
      {selected && (
        <TicketDetail
          ticket={selected}
          draft={draft}
          onDraft={handleDraft}
          onSend={handleSend}
          onClose={handleClose}
        />
      )}
      {notice && <p className="notice">{notice}</p>}
    </main>
  )
}
