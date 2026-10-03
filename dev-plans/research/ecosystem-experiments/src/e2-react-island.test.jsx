import { it, expect, afterEach } from 'vitest'
import { renderComponent } from 'sygnal'
import { createElement as h, useState } from 'react'
import { island } from './island.js'
import { reactAdapter } from './reactAdapter.js'

// An ordinary React component with internal state + a callback prop
function Stars({ value, max = 5, onChange }) {
  const [hover, setHover] = useState(0)
  return h('span', { className: 'stars' }, Array.from({ length: max }, (_, i) =>
    h('button', { key: i, 'data-i': i + 1, onMouseEnter: () => setHover(i + 1), onClick: () => onChange(i + 1) },
      (hover || value) > i ? '★' : '☆')))
}
const StarsAdapter = reactAdapter(Stars)

function App({ state }) {
  return <div>
    {island(StarsAdapter, { props: { value: state.rating }, events: ['onChange'], className: 'rating' })}
    <p className="out">{state.rating}</p>
    <button className="reset">reset</button>
  </div>
}
App.initialState = { rating: 2 }
App.intent = ({ DOM }) => ({
  RATE: DOM.select('.rating').events('onChange').map(e => e.detail),
  RESET: DOM.click('.reset'),
})
App.model = { RATE: (s, rating) => ({ ...s, rating }), RESET: s => ({ ...s, rating: 0 }) }

let t; afterEach(() => t?.dispose())
it('React component inside Sygnal: props in, callbacks out as actions', async () => {
  t = renderComponent(App, { dom: 'real' })
  await t.ready()
  expect(t.query('.stars').textContent).toBe('★★☆☆☆')
  t.query('.stars [data-i="4"]').click()                     // React onClick → onChange → CustomEvent → intent
  await t.next(s => s.rating === 4)
  expect(t.query('.stars').textContent).toBe('★★★★☆')        // Sygnal re-render → postpatch → React re-render
  t.query('.reset').click()
  await t.next(s => s.rating === 0)
  expect(t.query('.stars').textContent).toBe('☆☆☆☆☆')
  expect(t.query('.out').textContent).toBe('0')
})
