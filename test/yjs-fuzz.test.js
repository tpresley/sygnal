// sygnal/yjs: random concurrent sessions (ported from the spike's test/fuzz.test.tsx). Three apps,
// 40 random actions each run, random offline periods; at the end all online. Every run must
// converge (state = document on every client) with no duplicate ids. About a third of the actions
// are dispatched without waiting, so bursts coalesce into one LOCAL and REMOTE actions meet unsynced
// local edits. FUZZ_RUNS (default 20, the CI setting).
import { it, expect } from 'vitest'
import { client, createNetwork, until, converged } from './fixtures/yjs/helpers.js'

const rnd = (n) => Math.floor(Math.random() * n)

it('random concurrent sessions converge (FUZZ_RUNS, default 20, x 40 actions, 3 clients)', async () => {
  for (let run = 0, runs = Number(process.env.FUZZ_RUNS || 20); run < runs; run++) {
    const net = createNetwork()
    const cs = [client(net, 'a', { text: ['text'] }), client(net, 'b', { text: ['text'] }), client(net, 'c', { text: ['text'] })]
    let n = 0
    for (let step = 0; step < 40; step++) {
      const c = cs[rnd(3)], ids = c.ids()
      const r = rnd(10), act = Math.random() < 0.3 ? (a, d) => c.t.simulateAction(a, d) : c.act
      if (r == 0) { const p = cs[rnd(3)].peer; Math.random() < 0.5 ? p.offline() : p.online() }
      else if (r < 4 || !ids.length) await act('ADD', { id: `i${run}-${n++}`, text: 'x' })
      else if (r < 6) await act('EDIT', { id: ids[rnd(ids.length)], text: 'x'.repeat(rnd(5)) + 'y' })
      else if (r < 7) await act('TOGGLE', ids[rnd(ids.length)])
      else if (r < 9) await act('MOVE', { id: ids[rnd(ids.length)], to: rnd(ids.length) })
      else await act('REMOVE', ids[rnd(ids.length)])
    }
    for (const c of cs) await c.t.settle()
    for (const c of cs) c.peer.online()
    await until(() => converged(...cs))
    const ids = cs[0].ids()
    expect(new Set(ids).size).toBe(ids.length)
    for (const c of cs) c.t.dispose()
  }
}, 600000)
