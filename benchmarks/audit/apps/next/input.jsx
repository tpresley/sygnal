import { set } from 'sygnal'
import { run } from '../../../../dev-plans/research/core-rewrite/proto/core-next.ts'
import { items } from '../../lib/data.js'

// A controlled input next to a 1,000-item list rendered by the same component
function App({ state }) {
  return (
    <div>
      <input className="draft" value={state.draft} />
      <p className="echo">{state.draft}</p>
      <ul>
        {state.items.map(item => <li key={item.id}>{item.text}</li>)}
      </ul>
    </div>
  )
}
App.initialState = { draft: '', items: items() }
App.intent = ({ DOM }) => ({ DRAFT: DOM.input('.draft').value() })
App.model = { DRAFT: set((state, draft) => ({ draft })) }
run(App, {}, { mountPoint: '#main' })
