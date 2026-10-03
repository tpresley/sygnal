import { useState } from 'react'

export default function App() {
  const [view, setView] = useState('list')
  const [selected, setSelected] = useState(null)
  const items = []

  const open = (id) => {
    setSelected(id)
    setView('detail')
  }

  return (
    <div className="items-app">
      <h1>Items</h1>
      {view === 'list' ? (
        <section className="list">
          <p className="status"></p>
          <ul className="items">
            {items.map((item) => (
              <li key={item.id}>
                <button className="open" onClick={() => open(item.id)}>
                  {item.title}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <section className="detail">
          <button className="back" onClick={() => setView('list')}>
            Back to list
          </button>
          <p className="status"></p>
          <h2 className="item-title"></h2>
          <p className="item-body"></p>
        </section>
      )}
    </div>
  )
}
