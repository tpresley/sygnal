// @vitest-environment jsdom
// PLAN-6 3-F (G-625): a chat host loaded lazily into a running app. Nothing in this file calls
// chat() before run(): the host's module (helpers/p6-3f-lazy-host.js) does when lazy() imports
// it. The link then attaches its layer to the running app (window.__SYGNAL_DEVTOOLS_APP__'s
// runtime), so the assistant gets its tools and runs their calls: no SYG442.
import { it, expect, vi, afterEach } from 'vitest'
import run from '../src/extra/run.ts'
import { createElement as h } from '../src/pragma/index.ts'
import { lazy } from '../src/lazy.ts'
import { makeChatDriver } from '../src/extra/ai/chat/driver.ts'
import { memoryTransport } from '../src/extra/ai/chat/memoryTransport.ts'

const sleep = (ms = 5) => new Promise((r) => setTimeout(r, ms))
async function until(f, what) {
  for (let i = 0; i < 400 && !f(); i++) await sleep()
  if (!f()) throw new Error('timed out: ' + what)
}
const find = (iv, name) => {
  if (iv.name === name) return iv
  for (const c of iv.children()) { const x = find(c, name); if (x) return x }
}

let app
afterEach(() => { app?.dispose(); app = null; vi.restoreAllMocks() })

it('a lazily loaded chat host gets the link: tools, app state and its tool calls run', async () => {
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
  const Host = lazy(() => import('./helpers/p6-3f-lazy-host.js'))
  function Root() { return h('main', null, h(Host)) }
  const streams = []
  const transport = memoryTransport({ onStream: (s) => streams.push(s) })
  document.body.innerHTML = '<div id="root"></div>'
  app = run(Root, { LLM: makeChatDriver({ transport, coalesce: 'none' }) }, { mountPoint: '#root' })
  await until(() => document.querySelector('.count'), 'the lazy host')
  const iv = find(app.__runtime.root, 'Counter')
  app.__runtime.dispatch(iv.id, 'assistant.SEND', 'bump it')
  await until(() => streams.length === 1, 'the first request')
  const req = streams[0].request
  expect(Object.keys(req.tools).sort()).toEqual(['counter_bump', 'counter_read'])
  expect(req.messages[0].id).toBe('sygnal-app-state')
  streams[0].push({ type: 'tool-call', id: 'c1', name: 'counter_bump', input: {} }).end()
  await until(() => streams.length === 2, 'the request after the tool ran')
  expect(document.querySelector('.count').textContent).toBe('1')
  expect(streams[1].request.messages.at(-1).parts[0]).toMatchObject({ toolCallId: 'c1', state: 'output-available', output: { ok: true } })
  streams[1].push('Done.').end()
  await until(() => document.querySelector('.status').textContent === 'ready', 'the end of the turn')
  expect(errors.mock.calls.flat().join(' ')).not.toMatch(/SYG442/)
})
