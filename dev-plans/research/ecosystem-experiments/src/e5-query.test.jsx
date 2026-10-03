import { it, expect, afterEach } from 'vitest'
import { renderComponent } from 'sygnal'
import { makeQueryDriver } from './queryDriver.js'

let calls = 0
const fetchUser = async ({ queryKey: [, id] }) => { calls++; await new Promise(r => setTimeout(r, 5)); return { id, name: 'User ' + id } }

function Profile({ state }) {
  return <div><p className="name">{state.status === 'success' ? state.user.name : state.status}</p><button className="other">other</button><button className="refresh">refresh</button></div>
}
Profile.initialState = { userId: 1, status: 'idle', user: null }
Profile.intent = ({ DOM, QUERY }) => ({
  OTHER: DOM.click('.other'), REFRESH: DOM.click('.refresh'), RESULT: QUERY.select('user'),
})
Profile.model = {
  BOOTSTRAP: { QUERY: (s) => ({ category: 'user', queryKey: ['user', s.userId], queryFn: fetchUser, staleTime: 60_000 }) },
  OTHER: {
    STATE: (s) => ({ ...s, userId: s.userId === 1 ? 2 : 1 }),
    QUERY: (s) => ({ category: 'user', queryKey: ['user', s.userId === 1 ? 2 : 1], queryFn: fetchUser, staleTime: 60_000 }),
  },
  REFRESH: { QUERY: (s) => ({ invalidate: ['user', s.userId] }) },
  RESULT: (s, r) => ({ ...s, status: r.status, user: r.data ?? s.user }),
}

let t; afterEach(() => t?.dispose())
it('query-core driver: cache, key switching, invalidation', async () => {
  t = renderComponent(Profile, { dom: 'real', drivers: { QUERY: makeQueryDriver() } })
  await t.waitForState(s => s.user?.name === 'User 1')
  t.simulateEvent('.other', 'click'); await t.next(s => s.user?.name === 'User 2')
  t.simulateEvent('.other', 'click'); await t.next(s => s.user?.name === 'User 1')
  expect(calls).toBe(2)                         // user 1 served from cache (staleTime)
  t.simulateEvent('.refresh', 'click'); await new Promise(r => setTimeout(r, 30))
  expect(calls).toBe(3)                         // invalidation refetched the active query
})
