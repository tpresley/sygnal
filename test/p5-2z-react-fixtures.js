// PLAN-5 2-Z: a React component and a Sygnal app that renders it through fromReact. The same
// source runs on React (p5-2z-react.test.js) and on preact/compat (p5-2z-preact.test.js, which
// aliases react / react-dom / react-dom/client to preact/compat with vi.mock, as a bundler alias
// would).
import { createElement as r, useState, useEffect } from 'react'
import { createElement as h } from '../src/pragma/index.js'
import { fromReact } from '../src/react.ts'

export const log = { mounted: 0, unmounted: 0 }

// an ordinary React component: internal state (hover), callback props, an effect
export function StarRating({ value, max = 5, onChange, onHover }) {
  const [hover, setHover] = useState(0)
  useEffect(() => { log.mounted++; return () => { log.unmounted++ } }, [])
  return r('span', { className: 'stars', role: 'radiogroup', 'aria-label': 'Rating' },
    Array.from({ length: max }, (_, i) => r('button', {
      key: i, type: 'button', 'data-i': i + 1, role: 'radio', 'aria-checked': value === i + 1,
      onMouseEnter: () => { setHover(i + 1); onHover?.(i + 1, 'enter') },
      onClick: () => onChange(i + 1),
    }, (hover || value) > i ? '★' : '☆')))
}

export const Stars = fromReact(StarRating, { events: { rate: 'onChange', hover: 'onHover' } })

export function App({ state }) {
  return h('div', null,
    state.show ? h(Stars, { className: 'rating', value: state.rating, max: state.max }) : null,
    h('button', { className: 'reset' }, 'reset'),
    h('button', { className: 'more' }, 'more'),
    h('button', { className: 'hide' }, 'hide'),
    h('p', { className: 'out' }, String(state.rating)))
}
App.initialState = { rating: 2, max: 5, show: true, hover: null }
App.intent = ({ DOM }) => ({
  RATE: DOM.select('.rating').events('rate').detail(),
  HOVER: DOM.select('.rating').events('hover').detail(),
  RESET: DOM.click('.reset'),
  MORE: DOM.click('.more'),
  HIDE: DOM.click('.hide'),
})
App.model = {
  RATE: (s, rating) => ({ ...s, rating }),
  HOVER: (s, hover) => ({ ...s, hover }),
  RESET: (s) => ({ ...s, rating: 0 }),
  MORE: (s) => ({ ...s, max: 7 }),
  HIDE: (s) => ({ ...s, show: false }),
}

/** the shared assertions: React (or preact/compat) inside Sygnal */
export async function exercise(t, expect) {
  const settle = (ms = 20) => new Promise((res) => setTimeout(res, ms))
  log.mounted = 0; log.unmounted = 0
  await t.ready()
  await settle()
  expect(t.query('.rating .stars').textContent).toBe('★★☆☆☆')
  expect(log.mounted).toBe(1)
  // a React onClick → onChange → a dispatched DOM event → the intent → state → update → React
  t.query('.rating [data-i="4"]').click()
  await t.next((s) => s.rating === 4)
  await settle()
  expect(t.query('.rating .stars').textContent).toBe('★★★★☆')
  expect(t.query('.rating [data-i="4"]').getAttribute('aria-checked')).toBe('true')
  // a callback with two arguments: the detail is the array
  // (React synthesises onMouseEnter from mouseover at its root; Preact listens for mouseenter)
  const star = t.query('.rating [data-i="2"]')
  star.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, relatedTarget: document.body }))
  star.dispatchEvent(new MouseEvent('mouseenter', { relatedTarget: document.body }))
  await t.next((s) => s.hover)
  expect(t.state.hover).toEqual([2, 'enter'])
  // props flow in: the newest ones (not the mount-time props)
  t.query('.reset').click()
  await t.next((s) => s.rating === 0)
  t.query('.more').click()
  await t.next((s) => s.max === 7)
  await settle()
  expect(t.query('.rating .stars').textContent).toBe('★★☆☆☆☆☆')
  // the host keeps its class; the component didn't get className
  expect(t.query('.rating').className).toBe('rating')
  expect(t.query('.rating .stars').className).toBe('stars')
  expect(log.mounted).toBe(1)
  // removal unmounts the React tree
  t.query('.hide').click()
  await t.next((s) => !s.show)
  await settle()
  expect(t.query('.rating')).toBe(null)
  expect(log.unmounted).toBe(1)
}
