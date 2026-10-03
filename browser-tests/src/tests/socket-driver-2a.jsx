// PLAN-3 2-A: makeSocketDriver against a real WebSocket server and an SSE endpoint
// (browser-tests/socket-server.js, on the Vite dev server).
import { run, makeSocketDriver, ABORT } from 'sygnal'
import { mount, assert, runTest, waitFor } from '../harness.js'

const CAT = 'Socket driver (2-A)'

export async function socketDriverTests2A() {
  await runTest(CAT, 'makeSocketDriver: open, echo, a server close (willReconnect), reconnect', async () => {
    const { id, el } = mount()
    function Echo({ state }) { return <p className="log">{state.log.join('|')}</p> }
    Echo.initialState = { log: [] }
    const add = (s, entry) => ({ ...s, log: [...s.log, entry] })
    Echo.model = {
      BOOTSTRAP: {
        WS: () => ({ connections: { echo: {
          socket: '/__ws/echo', message: 'GOT', open: 'UP', close: 'DOWN',
          reconnect: { delayMs: 50, maxDelayMs: 50, jitter: false },
        } } }),
      },
      UP: {
        STATE: (s, { reconnected }) => add(s, reconnected ? 'reup' : 'up'),
        WS: (s, { reconnected }) => (reconnected ? ABORT : { to: 'echo', json: { hello: 'world' } }),
      },
      GOT: {
        STATE: (s, msg) => add(s, `got:${msg.hello}`),
        WS: () => ({ to: 'echo', text: 'close-me' }),
      },
      DOWN: (s, { code, reason, willReconnect }) => add(s, `down:${code}:${reason}:${willReconnect}`),
    }
    const app = run(Echo, { WS: makeSocketDriver() }, { mountPoint: id })
    try {
      await waitFor(() => el.querySelector('.log')?.textContent.includes('reup'), 2500)
      const log = el.querySelector('.log').textContent
      assert(log === 'up|got:world|down:4000:bye:true|reup', `got '${log}'`)
    } finally {
      app.dispose()
    }
  }, 4000)

  await runTest(CAT, 'makeSocketDriver: an SSE stream (message, named event, native reconnect)', async () => {
    const { id, el } = mount()
    function Feed({ state }) { return <p className="log">{state.log.join('|')}</p> }
    Feed.initialState = { log: [] }
    const add = (s, entry) => ({ ...s, log: [...s.log, entry] })
    Feed.model = {
      BOOTSTRAP: {
        WS: () => ({ connections: { feed: { sse: '/__sse', message: 'MSG', open: 'UP', close: 'DOWN', events: { tick: 'TICK' } } } }),
      },
      UP: (s, { reconnected }) => add(s, reconnected ? 'reup' : 'up'),
      MSG: (s, { n }) => add(s, 'msg'),
      TICK: (s, { n }) => add(s, 'tick'),
      DOWN: (s, { willReconnect }) => add(s, `down:${willReconnect}`),
    }
    const app = run(Feed, { WS: makeSocketDriver() }, { mountPoint: id })
    try {
      await waitFor(() => el.querySelector('.log')?.textContent.split('|').length >= 7, 2500)
      const log = el.querySelector('.log').textContent.split('|').slice(0, 7).join('|')
      assert(log === 'up|msg|tick|down:true|reup|msg|tick', `got '${log}'`)
    } finally {
      app.dispose()
    }
  }, 4000)
}
