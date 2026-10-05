// @vitest-environment jsdom
// PLAN-5 2-Z (W-2, D203): sygnal/react fromReact with React 19 (react-dom/client). The mock DOM
// can't run React; dom: 'real' does. preact/compat: p5-2z-preact.test.js.
import { it, expect, afterEach } from 'vitest'
import { createElement as r, forwardRef, memo } from 'react'
import { renderComponent } from '../src/extra/testing.js'
import { renderToString } from '../src/extra/ssr.ts'
import { createElement as h } from '../src/pragma/index.js'
import { fromReact } from '../src/react.ts'
import { App, Stars, StarRating, exercise } from './p5-2z-react-fixtures.js'

let t
afterEach(() => { try { t?.dispose() } catch (_) {} t = null; document.body.innerHTML = '' })

it('React inside Sygnal: props in, callbacks out as dispatched events, newest props, unmount', async () => {
  t = renderComponent(App, { dom: 'real' })
  await exercise(t, expect)
})

it('the mock DOM renders the host; t.widget().dispatch reaches the intent', async () => {
  t = renderComponent(App)
  await t.ready()
  expect(t.widget('.rating').props.value).toBe(2)
  t.widget('.rating').dispatch('rate', 5)
  await t.next((s) => s.rating === 5)
})

it('events as an array dispatch under the callback name; a callback passed as a prop runs first', async () => {
  const W = fromReact(({ onPick }) => r('button', { className: 'b', onClick: () => onPick('a') }, 'b'), { events: ['onPick'] })
  const seen = []
  function C({ state }) { return h('div', null, h(W, { className: 'w', onPick: (v) => seen.push(v) }), h('p', { className: 'o' }, String(state.v))) }
  C.initialState = { v: null }
  C.intent = ({ DOM }) => ({ V: DOM.select('.w').events('onPick').detail() })
  C.model = { V: (s, v) => ({ ...s, v }) }
  t = renderComponent(C, { dom: 'real' })
  await t.ready()
  await new Promise((res) => setTimeout(res, 20))
  t.query('.w .b').click()
  await t.next((s) => s.v)
  expect(t.state.v).toBe('a')
  expect(seen).toEqual(['a'])
})

it('a memo / forwardRef component works; the name defaults to its displayName or function name', () => {
  const M = memo(StarRating)
  M.displayName = 'Rated'
  expect(fromReact(M).def.name).toBe('Rated')
  expect(fromReact(forwardRef((p, ref) => r('i', { ref }))).kind).toBe('widget')
  expect(Stars.def.name).toBe('StarRating')
})

it('SSR renders the host with the fallback', () => {
  const S = fromReact(StarRating, { events: { rate: 'onChange' }, fallback: (p, hh) => hh('span', { className: 'stars-ssr' }, `${p.value} of 5`) })
  const html = renderToString(() => h('div', null, h(S, { className: 'rating', value: 3 })))
  expect(html).toContain('<div class="rating"><span class="stars-ssr">3 of 5</span></div>')
})

it('SYG667: not a component', () => {
  expect(() => fromReact('div')).toThrow(/SYG667.*not a React component/)
  expect(() => fromReact(null)).toThrow(/SYG667/)
})
