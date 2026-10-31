// @vitest-environment jsdom
// llms-context A/B, task 33: `DOM.<event>(selector, options)` dropped the options, so
// `DOM.submit('.jump', { preventDefault: true })` never prevented the page reload. The shorthand
// now passes them to events(), as `DOM.select(selector).events(type, options)` does.
import { describe, it, expect, afterEach } from 'vitest'
import { run } from '../src/index.js'
import { createElement as h } from '../src/pragma/index.js'

let app
afterEach(() => { app?.dispose(); app = null; document.body.innerHTML = '' })

const wait = (ms = 20) => new Promise((r) => setTimeout(r, ms))

function start(intent) {
  const App = ({ state }) => h('form', { className: 'jump' }, h('button', { attrs: { type: 'submit' } }, 'Go'), h('p', { className: 'n' }, String(state.n)))
  App.initialState = { n: 0 }
  App.intent = intent
  App.model = { JUMP: (s) => ({ ...s, n: s.n + 1 }) }
  const root = document.createElement('div'); root.id = 'root'; document.body.appendChild(root)
  app = run(App, {}, { mountPoint: '#root' })
  return root
}
async function submit(root) {
  await wait()
  const e = new Event('submit', { bubbles: true, cancelable: true })
  root.querySelector('form').dispatchEvent(e)
  await wait()
  return e
}

describe('DOM.<event>(selector, options)', () => {
  it('passes the options to events(): preventDefault applies', async () => {
    const root = start(({ DOM }) => ({ JUMP: DOM.submit('.jump', { preventDefault: true }) }))
    const e = await submit(root)
    expect(e.defaultPrevented).toBe(true)
    expect(root.querySelector('.n').textContent).toBe('1')
  })

  it('without options the default is left alone', async () => {
    const root = start(({ DOM }) => ({ JUMP: DOM.submit('.jump') }))
    const e = await submit(root)
    expect(e.defaultPrevented).toBe(false)
    expect(root.querySelector('.n').textContent).toBe('1')
  })
})
