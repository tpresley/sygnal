import { run, VirtualCollection } from 'sygnal'

const FIRST = ['Ada', 'Alan', 'Grace', 'Linus', 'Barbara', 'Edsger', 'Margaret', 'Ken', 'Radia', 'Tim']
const LAST = ['Lovelace', 'Turing', 'Hopper', 'Torvalds', 'Liskov', 'Dijkstra', 'Hamilton', 'Thompson', 'Perlman', 'Berners-Lee']

// a row's state is its array element: it survives being scrolled out and back in
function Row({ state }) {
  return (
    <div className={state.starred ? 'person starred' : 'person'}>
      <span className="idx">#{state.id}</span>
      <span className="name">{state.name}</span>
      <button className="star" aria-pressed={String(state.starred)} aria-label={`Star ${state.name}`}>{state.starred ? '★' : '☆'}</button>
    </div>
  )
}
Row.intent = ({ DOM }) => ({ STAR: DOM.click('.star') })
Row.model = { STAR: (state) => ({ ...state, starred: !state.starred }) }

export function People({ state }) {
  const starred = state.people.filter((p) => p.starred).length
  return (
    <section>
      <div className="row">
        <label>Row <input className="target" type="number" min="1" max={state.people.length} value={state.target} /></label>
        <button className="jump">Jump to row {state.target}</button>
        <button className="top">Top</button>
        <span className="muted">{state.people.length.toLocaleString()} rows · {starred} starred</span>
      </div>
      <VirtualCollection of={Row} from="people" className="people" estimateSize={34} aria-label="People" />
      <p className="muted">Star a row, then scroll far away with the wheel: the focused row stays rendered, so focus and your place are kept.</p>
    </section>
  )
}

People.initialState = {
  target: 9000,
  people: Array.from({ length: 10000 }, (_, i) => ({
    id: i + 1,
    name: `${FIRST[i % 10]} ${LAST[Math.floor(i / 10) % 10]} ${Math.floor(i / 100) + 1}`,
    starred: false,
  })),
}

People.intent = ({ DOM }) => ({
  TARGET: DOM.input('.target').value(Number),
  JUMP: DOM.click('.jump'),
  TOP: DOM.click('.top'),
})

People.model = {
  TARGET: (state, target) => ({ ...state, target }),
  // the target row isn't rendered yet: the container's own command scrolls to it
  JUMP: { ELEMENT: (state) => ({ scrollToIndex: '.people', index: state.target - 1, align: 'start' }) },
  TOP: { ELEMENT: { scrollToIndex: '.people', index: 0 } },
}

export const start = (mountPoint, uid) => run(People, {}, { mountPoint, uid })
