// @vitest-environment jsdom
// The worker path (host tree → patch ops → page) with the forms that crashed or went stale on the
// DOM driver: style="a: b", a class key with spaces, a boolean style value.
import { it, expect, afterEach, vi } from 'vitest'
import { run, createElement as h } from 'sygnal'
import { createWorkerTarget } from 'sygnal/worker'
import { startBridge } from 'sygnal/worker/page'

const until = (fn) => vi.waitFor(fn, { timeout: 2000, interval: 10 })
let env = null
afterEach(() => { env?.app.dispose(); env?.bridge.stop(); env?.ch.port1.close(); env?.ch.port2.close(); env = null })

it('renders and patches them on the page', async () => {
  document.body.innerHTML = '<div id="root"></div>'
  const mount = document.getElementById('root')
  const ch = new MessageChannel()
  const bridge = startBridge(ch.port2, mount, {})
  const target = createWorkerTarget(ch.port1)
  function App({ state }) {
    return h('div', null,
      h('p', { className: 'a', style: state.on ? 'color: red; margin-top: 2px' : { color: 'blue' } }, 'a'),
      h('p', { className: 'b', class: { 'p-4 m-2': state.on } }, 'b'),
      h('p', { className: 'c', style: { color: state.on && 'red' } }, 'c'),
      h('button', { className: 'go' }, 'go'))
  }
  App.initialState = { on: true }
  App.intent = ({ DOM }) => ({ GO: DOM.click('.go') })
  App.model = { GO: (s) => ({ ...s, on: false }) }
  const app = run(App, { DOM: target.driver })
  env = { app, bridge, ch }
  await until(() => expect(mount.querySelector('.a')).toBeTruthy())
  const q = (s) => mount.querySelector(s)
  expect(q('.a').style.color).toBe('red')
  expect(q('.a').style.marginTop).toBe('2px')
  expect(q('.b').classList.contains('m-2')).toBe(true)
  expect(q('.c').style.color).toBe('red')
  q('.go').click()
  await until(() => expect(q('.b').classList.contains('m-2')).toBe(false))
  expect(q('.a').style.color).toBe('blue')
  expect(q('.a').style.marginTop).toBe('')
  expect(q('.c').style.color).toBe('')
})
