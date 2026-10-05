// @vitest-environment jsdom
// G-348 (P46-Q): a view that runs again with the same output re-emits its last vnode (P46-P).
// renderComponent's real-DOM harness tags each emitted tree with the states it rendered; the
// re-emitted vnode kept the tag of its earlier emission, so the harness took the DOM to be one
// render behind and held the next input until another render (or eventWaitMs). Found by the
// stopwatch recipe (test/p4-3c-recipe.test.js): a click 50 ms after a same-output render was lost
import { it, expect, afterEach, vi } from 'vitest'
import { renderComponent } from 'sygnal'
import { jsx, jsxs } from 'sygnal/jsx-runtime'

function Counter({ state }) {
  return jsxs('div', { children: [
    jsx('p', { className: 'n', children: String(state.n) }),
    jsx('button', { className: 'touch', children: 'touch' }),
    jsx('button', { className: 'inc', children: 'inc' }),
  ] })
}
Counter.initialState = { n: 0, touched: 0 }
Counter.intent = ({ DOM }) => ({ TOUCH: DOM.click('.touch'), INC: DOM.click('.inc') })
Counter.model = {
  // a new state, the same view output
  TOUCH: (state) => ({ ...state, touched: state.touched + 1 }),
  INC: (state) => ({ ...state, n: state.n + 1 }),
}

let t
afterEach(() => { try { t?.dispose() } catch (_) {} t = null; vi.useRealTimers() })

it('an input after a same-output render is delivered at once (fake timers)', async () => {
  vi.useFakeTimers()
  t = renderComponent(Counter, { dom: 'real' })
  await t.ready()
  t.simulateEvent('.inc', 'click')
  await vi.advanceTimersByTimeAsync(50)
  t.simulateEvent('.touch', 'click')        // re-renders the same vnode
  await vi.advanceTimersByTimeAsync(50)
  expect(t.state.touched).toBe(1)
  t.simulateEvent('.inc', 'click')
  await vi.advanceTimersByTimeAsync(50)
  expect(t.state.n).toBe(2)
  expect(t.query('.n').textContent).toBe('2')
})

it('an input after a same-output render is delivered at once (real timers)', async () => {
  t = renderComponent(Counter, { dom: 'real' })
  await t.ready()
  t.simulateEvent('.touch', 'click')
  await t.next()
  const start = Date.now()
  t.simulateEvent('.inc', 'click')
  await t.next()
  expect(Date.now() - start).toBeLessThan(200)
  expect(t.query('.n').textContent).toBe('1')
})
