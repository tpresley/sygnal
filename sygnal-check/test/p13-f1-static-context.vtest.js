// PLAN-13 F-1: context reads in the declaration statics' second parameter count for SYG170
import { describe, expect, it } from 'vitest'
import { checkFiles } from '../src/index.js'

const app = (statics) => `import { run } from 'sygnal'
function Page() { return <p>x</p> }
${statics}
Page.model = { POLL: (s) => s }
function App() { return <main><Page state="page" /></main> }
App.initialState = { route: { params: { id: '1' } }, page: {} }
App.context = { route: (s) => s.route }
run(App)
`
const run = (src) => {
  const file = '/virtual/app/App.jsx'
  return checkFiles([file], { cwd: '/virtual/app', sources: { [file]: src } }).filter(d => d.code === 'SYG170')
}

describe('F-1: SYG170 sees the statics', () => {
  it('a provided key read in resources / timers / head is fine', () => {
    expect(run(app(`Page.resources = { item: (s, { route }) => '/api/' + route.params.id }
Page.timers = (s, ctx) => ({ poll: { every: 1000, action: 'POLL', n: ctx.route } })
Page.head = (s, { route }) => ({ title: route.params.id })`))).toEqual([])
  })
  // 7.2: the second parameter is the bag; its context is `context` (a top-level key is a legacy
  // context read only when some .context declares it: otherwise a prop)
  it('a key no ancestor provides is reported, in each static form', () => {
    for (const st of [
      `Page.resources = { item: (s, { context: { user } }) => '/api/' + user.id }`,
      `Page.timers = (s, b) => ({ poll: { every: b.context.user, action: 'POLL' } })`,
      `const conns = (s, { context }) => ({ feed: { sse: '/e/' + context.user } })\nPage.connections = conns`,
      `Page.route = (s, { context: { user } }) => user`,
    ]) {
      const d = run(app(st))
      expect(d.map(x => x.message), st).toHaveLength(1)
      expect(d[0].message).toContain('user')
    }
  })
  it('a top-level bag key (7.2 legacy form) counts only when some .context declares it', () => {
    // 'user' is declared by no .context: a prop, not reported
    expect(run(app(`Page.resources = { item: (s, { user }) => '/api/' + user.id }
Page.timers = (s, ctx) => ({ poll: { every: ctx.user, action: 'POLL' } })`))).toEqual([])
    // 'user' declared by a component off the chain: a context read with no provider above Page
    const d = run(app(`Page.resources = { item: (s, { user }) => '/api/' + user.id }
function Other() { return <p /> }
Other.context = { user: () => 1 }`))
    expect(d).toHaveLength(1)
    expect(d[0].message).toContain('user')
  })
})
