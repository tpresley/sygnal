// Two clients on one server: B's list follows A's mutation through the server's $sync stream,
// with no polling and no code in B that knows about A's mutation.
import { describe, it, expect } from 'vitest'
import { renderComponent, makeFetchDriver, makeSocketDriver } from 'sygnal'
import { Quotes } from '../app/Quotes.tsx'
import { withSync } from '../app/Sync.tsx'
import { makeApp, makeStore } from '../app/server.ts'

const until = async (cond: () => boolean, ms = 2000) => {
  const end = Date.now() + ms
  while (!cond()) { if (Date.now() > end) throw new Error('timed out'); await new Promise((r) => setTimeout(r, 10)) }
}

describe('server-driven invalidation ($sync)', () => {
  it("a mutation on one client refetches the other client's resources", async () => {
    const app = makeApp(makeStore().impl)
    const fetch = async (url: any, init?: any) => app.fetch(new Request(new URL(String(url), 'http://localhost'), init))
    const client = () => {
      const log: string[] = []
      const logged = async (u: any, i?: any) => { log.push(String(u)); return fetch(u, i) }
      const t = renderComponent(withSync(Quotes), { drivers: { HTTP: makeFetchDriver({ fetch: logged }), WS: makeSocketDriver({ fetch: logged }) } })
      return { t, lists: () => log.filter((u) => u.includes('/rpc/listQuotes')).length }
    }
    const a = client(), b = client()
    await until(() => a.t.state.quotes.status === 'success' && b.t.state.quotes.status === 'success')
    await new Promise((r) => setTimeout(r, 30))          // both $sync streams open
    expect(b.lists()).toBe(1)

    await a.t.simulateAction('TYPE', 'Synced.')
    await a.t.simulateAction('ADD')
    await until(() => b.t.state.quotes.data?.length === 2)   // B refetched on A's mutation
    expect(b.lists()).toBe(2)
    expect(b.t.state.quotes.data!.at(-1)!.text).toBe('Synced.')
    a.t.dispose(); b.t.dispose()
  })
})
