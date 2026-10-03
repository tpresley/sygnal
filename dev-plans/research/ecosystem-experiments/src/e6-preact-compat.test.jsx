// Same React component source, run on preact/compat (the bundler would alias react → preact/compat)
import { it, expect, afterEach } from 'vitest'
import { renderComponent } from 'sygnal'
import { createElement as h, useState, render, unmountComponentAtNode } from 'preact/compat'
import { flushSync } from 'preact/compat'
import { island } from './island.js'

function Stars({ value, max = 5, onChange }) {
  const [hover, setHover] = useState(0)
  return h('span', { className: 'stars' }, Array.from({ length: max }, (_, i) =>
    h('button', { key: i, 'data-i': i + 1, onMouseEnter: () => setHover(i + 1), onClick: () => onChange(i + 1) },
      (hover || value) > i ? '★' : '☆')))
}
const preactAdapter = (C) => ({
  mount(el, p) { flushSync(() => render(h(C, p), el)); return { el } },
  update(i, p) { flushSync(() => render(h(C, p), i.el)) },
  unmount(i) { unmountComponentAtNode(i.el) },
})
function App({ state }) {
  return <div>{island(preactAdapter(Stars), { props: { value: state.rating }, events: ['onChange'], className: 'rating' })}</div>
}
App.initialState = { rating: 2 }
App.intent = ({ DOM }) => ({ RATE: DOM.select('.rating').events('onChange').map(e => e.detail) })
App.model = { RATE: (s, rating) => ({ ...s, rating }) }

let t; afterEach(() => t?.dispose())
it('React-API component on preact/compat inside Sygnal', async () => {
  t = renderComponent(App, { dom: 'real' })
  await t.ready()
  expect(t.query('.stars').textContent).toBe('★★☆☆☆')
  t.query('.stars [data-i="5"]').click()
  await t.next(s => s.rating === 5)
  await new Promise(r => setTimeout(r, 0))
  expect(t.query('.stars').textContent).toBe('★★★★★')
})
