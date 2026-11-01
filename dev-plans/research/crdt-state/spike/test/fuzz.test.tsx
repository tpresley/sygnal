// Random concurrent sessions: three apps, random actions, random offline periods; at the end all
// online. Every run must converge (state = document on every client) with no duplicate ids.
import { it, expect } from 'vitest'
import { client, createNetwork, until } from './helpers.ts'
import { read } from '../lib/mapping.ts'

const rnd = (n: number) => Math.floor(Math.random() * n)

it('random concurrent sessions converge (FUZZ_RUNS, default 20, x 40 actions, 3 clients)', async () => {
  for (let run = 0, runs = Number(process.env.FUZZ_RUNS || 20); run < runs; run++) {
    const net = createNetwork()
    const cs = [client(net, 'a', { text: ['text'] }), client(net, 'b', { text: ['text'] }), client(net, 'c', { text: ['text'] })]
    let n = 0
    for (let step = 0; step < 40; step++) {
      const c = cs[rnd(3)], ids = c.ids()
      const r = rnd(10)
      if (r == 0) { const p = cs[rnd(3)].peer; Math.random() < 0.5 ? p.offline() : p.online() }
      else if (r < 4 || !ids.length) await c.act('ADD', { id: `i${run}-${n++}`, text: 'x' })
      else if (r < 6) await c.act('EDIT', { id: ids[rnd(ids.length)], text: 'x'.repeat(rnd(5)) + 'y' })
      else if (r < 7) await c.act('TOGGLE', ids[rnd(ids.length)])
      else if (r < 9) await c.act('MOVE', { id: ids[rnd(ids.length)], to: rnd(ids.length) })
      else await c.act('REMOVE', ids[rnd(ids.length)])
    }
    for (const c of cs) c.peer.online()
    const json = (c: any) => JSON.stringify(c.board())
    await until(() => cs.every((c) => json(c) === json(cs[0]) && JSON.stringify(read(c.peer.doc.getMap('board'), 'board')) === json(cs[0])))
    const ids = cs[0].ids()
    expect(new Set(ids).size).toBe(ids.length)
    for (const c of cs) c.t.dispose()
  }
}, 600000)
