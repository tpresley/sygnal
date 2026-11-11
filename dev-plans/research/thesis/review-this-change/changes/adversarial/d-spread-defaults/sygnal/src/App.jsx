import { set } from 'sygnal'
import TicketDetail from './TicketDetail.jsx'

function App({ state }) {
  return (
    <main className="inbox">
      <nav>
        <button className="folder" data-folder="open">Open</button>
        <button className="folder" data-folder="closed">Closed</button>
      </nav>
      <input className="search" aria-label="Search tickets" value={state.query} />
      <ul>
        {state.visible.map((t) => (
          <li key={t.id}>
            <button className="ticket" data-id={t.id}>{t.subject}</button>
          </li>
        ))}
      </ul>
      {state.selected && <TicketDetail />}
      {state.notice && <p className="notice">{state.notice}</p>}
    </main>
  )
}

const VIEW_DEFAULTS = { query: '', selectedId: null, drafts: {}, notice: null }

App.initialState = { tickets: [], folder: 'open', ...VIEW_DEFAULTS }

App.calculated = {
  visible: (state) =>
    state.tickets.filter(
      (t) => t.status === state.folder && t.subject.toLowerCase().includes(state.query.toLowerCase()),
    ),
  selected: (state) => state.tickets.find((t) => t.id === state.selectedId) ?? null,
}

App.intent = ({ DOM }) => ({
  PICK_FOLDER: DOM.click('.folder').data('folder'),
  SEARCH: DOM.input('.search').value(),
  SELECT: DOM.click('.ticket').data('id'),
})

App.model = {
  BOOTSTRAP: { HTTP: () => ({ url: '/api/tickets', ok: 'LOADED', error: 'FAILED' }) },
  LOADED: set((state, tickets) => ({ tickets })),
  FAILED: set({ notice: 'Could not load tickets.' }),
  PICK_FOLDER: set((state, folder) => ({ folder, ...VIEW_DEFAULTS })),
  SEARCH: set((state, query) => ({ query })),
  SELECT: set((state, selectedId) => ({ selectedId, notice: null })),
}

export default App
