import { useState } from 'react'
import { QueryClient, QueryClientProvider, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

async function request(url, init) {
  const response = await fetch(url, init)
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return response.json()
}

// "Loading…" without data, "Updating…" while cached data is reloaded, nothing otherwise
const statusOf = (query) => (query.isPending ? 'Loading…' : '') // mutant: no background indicator

// ['items'] is the list, ['items', id] an item: invalidating ['items'] marks both stale
function ItemList({ onOpen }) {
  const list = useQuery({ queryKey: ['items'], queryFn: () => request('/api/items') })
  return (
    <section className="list">
      <p className="status">{statusOf(list)}</p>
      <ul className="items">
        {(list.data ?? []).map((item) => (
          <li key={item.id}>
            <button className="open" onClick={() => onOpen(item.id)}>
              {item.title}
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}

function ItemDetail({ id, onBack }) {
  const queryClient = useQueryClient()
  const query = useQuery({ queryKey: ['items', id], queryFn: () => request(`/api/items/${id}`) })
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const save = useMutation({
    mutationFn: (title) =>
      request(`/api/items/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title }),
      }),
    onSuccess: () => {
      setEditing(false)
      // cancels a reload in flight and refetches the item; the list refetches when shown
      return queryClient.invalidateQueries({ queryKey: ['items'] })
    },
  })
  const item = query.data

  return (
    <section className="detail">
      <button className="back" onClick={onBack}>
        Back to list
      </button>
      <p className="status">{statusOf(query)}</p>
      <h2 className="item-title">{item ? item.title : ''}</h2>
      <p className="item-body">{item ? item.body : ''}</p>
      {item && !editing && (
        <button
          className="edit-open"
          onClick={() => {
            setDraft(item.title)
            save.reset()
            setEditing(true)
          }}
        >
          Edit
        </button>
      )}
      {editing && (
        <div className="edit">
          <input name="title" value={draft} onChange={(e) => setDraft(e.target.value)} />
          <button className="save" onClick={() => save.mutate(draft)}>
            Save
          </button>
          <p className="save-error">{save.isError ? 'Could not save the item.' : ''}</p>
        </div>
      )}
    </section>
  )
}

export default function App() {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 2000, retry: false, refetchOnWindowFocus: false },
          mutations: { retry: false },
        },
      })
  )
  const [selected, setSelected] = useState(null)

  return (
    <QueryClientProvider client={queryClient}>
      <div className="items-app">
        <h1>Items</h1>
        {selected === null ? (
          <ItemList onOpen={setSelected} />
        ) : (
          <ItemDetail key={selected} id={selected} onBack={() => setSelected(null)} />
        )}
      </div>
    </QueryClientProvider>
  )
}
