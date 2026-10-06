// PLAN-2 4-F: the causes of the p4-final slowdown (P4-REGRESSION-DIAGNOSIS.md)
//  C1: calculated fields in the stored state go stale after a child's (Collection item,
//      state="slice" child) write; the view was right, t.state / t.states were not
//  C2: the fake HTTP source tracked requests by object identity, so a constant request
//      object re-sent after t.fail was "already answered"
//  C3: t.html() escaped ' and " in text like SSR (Couldn&#39;t) instead of like innerHTML
import { describe, it, expect, afterEach } from 'vitest'

if (typeof globalThis.window === 'undefined') {
  globalThis.window = undefined
}

import { renderComponent } from '../src/extra/testing.js'
import { renderToString } from '../src/extra/ssr.js'
import { createElement as h } from '../src/pragma/index.js'
import { Collection } from '../src/collection.js'
import { _resetDiagnostics } from '../src/extra/diagnostics/index.js'

let t
afterEach(() => {
  try { t?.dispose() } catch (_) {}
  t = null
  _resetDiagnostics()
})

// ---- C1 -------------------------------------------------------------------------------

function Item({ state }) {
  return h('li', { className: state.done ? 'item done' : 'item' },
    h('input', { type: 'checkbox', className: 'toggle', checked: state.done }))
}
Item.intent = ({ DOM }) => ({ TOGGLE: DOM.change('.toggle') })
Item.model = { TOGGLE: s => ({ ...s, done: !s.done }) }

function Tasks({ state }) {
  return h('div', null,
    h('p', { className: 'summary' }, `${state.openCount} open`),
    h('button', { className: 'add' }, 'add'),
    h('ul', { className: 'list' }, h(Collection, { of: Item, from: 'items' })))
}
Tasks.initialState = { items: [{ id: 1, done: false }, { id: 2, done: false }, { id: 3, done: true }] }
Tasks.calculated = { openCount: s => s.items.filter(i => !i.done).length }
Tasks.intent = ({ DOM }) => ({ ADD: DOM.click('.add') })
Tasks.model = { ADD: s => ({ ...s, items: [...s.items, { id: s.items.length + 1, done: false }] }) }

function Log({ state }) {
  return h('div', { className: 'log' }, h('button', { className: 'note' }, 'note'), h('span', null, String(state.length)))
}
Log.intent = ({ DOM }) => ({ NOTE: DOM.click('.note') })
Log.model = { NOTE: s => [...s, 'entry'] }

function Inbox({ state }) {
  return h('div', null,
    h('p', { className: 'counts' }, `${state.entryCount} entries`),
    h(Log, { state: 'activity' }))
}
Inbox.initialState = { activity: [] }
Inbox.calculated = { entryCount: s => s.activity.length }

describe('C1: calculated fields after a child writes', () => {
  it('a Collection item edit leaves t.state.openCount current', async () => {
    t = renderComponent(Tasks)
    await t.ready()
    expect(t.state.openCount).toBe(2)
    t.simulateEvent('.item:nth-child(1) .toggle', 'change')
    await t.next(s => s.items[0].done === true)
    expect(t.state.openCount).toBe(1)
    expect(t.html()).toContain('1 open')
    // the predicate form agents write
    t.simulateEvent('.item:nth-child(2) .toggle', 'change')
    await t.next(s => s.openCount === 0)
    expect(t.states.map(s => s.openCount)).toEqual([2, 1, 0])
  })

  it('the root\'s own reducer still stores current values', async () => {
    t = renderComponent(Tasks)
    await t.ready()
    t.simulateEvent('.add', 'click')
    await t.next(s => s.items.length === 4)
    expect(t.state.openCount).toBe(3)
  })

  it('a state="slice" child\'s write updates the root\'s calculated field', async () => {
    t = renderComponent(Inbox)
    await t.ready()
    t.simulateEvent('.note', 'click')
    await t.next(s => s.activity.length === 1)
    expect(t.state.entryCount).toBe(1)
    t.simulateEvent('.note', 'click')
    await t.next(s => s.entryCount === 2)
    expect(t.html()).toContain('2 entries')
  })
})

// ---- C2 -------------------------------------------------------------------------------

const REQ = { category: 'courses', url: '/api/courses' }
function Courses({ state }) {
  return h('div', null,
    h('p', { className: 'status' }, state.status),
    h('button', { className: 'load' }, 'load'),
    h('button', { className: 'retry' }, 'retry'))
}
Courses.initialState = { status: 'idle', courses: [] }
Courses.intent = ({ DOM, HTTP }) => ({
  LOAD: DOM.click('.load'),
  RETRY: DOM.click('.retry'),
  LOADED: HTTP.select('courses'),
  FAILED: HTTP.errors('courses'),
})
Courses.model = {
  LOAD: { STATE: s => ({ ...s, status: 'loading' }), HTTP: () => REQ },
  RETRY: { STATE: s => ({ ...s, status: 'loading' }), HTTP: () => REQ },
  LOADED: (s, { value }) => ({ ...s, status: 'ready', courses: value }),
  FAILED: s => ({ ...s, status: 'error' }),
}

describe('C2: the fake HTTP source tracks each send', () => {
  it('t.fail, Retry re-sending the same constant object, then t.respond', async () => {
    t = renderComponent(Courses)
    await t.ready()
    t.simulateEvent('.load', 'click')
    await t.next(s => s.status === 'loading')
    t.fail('HTTP', 500)
    await t.next(s => s.status === 'error')
    t.simulateEvent('.retry', 'click')
    await t.next(s => s.status === 'loading')
    expect(t.requests('HTTP')).toEqual([REQ, REQ])
    t.respond('HTTP', ['a'])
    await t.next(s => s.status === 'ready')
    expect(t.state.courses).toEqual(['a'])
  })

  it('two sends of one object are two pending requests; { request } answers the latest pending send', async () => {
    t = renderComponent(Courses)
    await t.ready()
    t.simulateEvent('.load', 'click')
    t.simulateEvent('.retry', 'click')
    await t.waitForState(() => t.requests('HTTP').length === 2)
    t.respond('HTTP', ['second'], { request: REQ })
    await t.next(s => s.status === 'ready')
    expect(t.state.courses).toEqual(['second'])
    // the earlier send is still pending
    t.respond('HTTP', ['first'], { request: REQ })
    await t.next(s => s.courses[0] === 'first')
    // now both are answered: nothing matches (PLAN-3 1-C, G-140: throws at the call)
    expect(() => t.respond('HTTP', ['third'], { request: REQ })).toThrow(/no pending HTTP request/)
    await t.settle()
    expect(t.state.courses).toEqual(['first'])
  })

  it('a string request re-sent is two requests too', async () => {
    function S({ state }) { return h('div', null, h('button', { className: 'go' }, 'go'), h('p', null, String(state.n))) }
    S.initialState = { n: 0 }
    S.intent = ({ DOM, HTTP }) => ({ GO: DOM.click('.go'), GOT: HTTP.select() })
    S.model = { GO: { HTTP: () => '/api/n' }, GOT: (s, { value }) => ({ ...s, n: s.n + value }) }
    t = renderComponent(S)
    await t.ready()
    t.simulateEvent('.go', 'click')
    t.simulateEvent('.go', 'click')
    t.respond('HTTP', 1)
    t.respond('HTTP', 2)
    await t.next(s => s.n === 3)
  })
})

// ---- C3 -------------------------------------------------------------------------------

function Msg() {
  return h('div', { title: `Tom's "quote" & <co>` }, h('p', null, `Couldn't load "courses" & <retry>`))
}

describe('C3: t.html() serialises like innerHTML', () => {
  it('escapes only & < > in text and & " in attributes', async () => {
    t = renderComponent(Msg)
    await t.ready()
    expect(t.html()).toBe(`<div title="Tom's &quot;quote&quot; &amp; <co>"><p>Couldn't load "courses" &amp; &lt;retry&gt;</p></div>`)
  })

  it('SSR output is unchanged', () => {
    expect(renderToString(Msg)).toBe(`<div title="Tom&#39;s &quot;quote&quot; &amp; &lt;co&gt;" data-sygnal-ssr=""><p>Couldn&#39;t load &quot;courses&quot; &amp; &lt;retry&gt;</p></div>`)
  })
})
