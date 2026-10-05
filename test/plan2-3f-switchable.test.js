// PLAN-2 3-F: Switchable bugs found by the Phase 3 evals (G-120, G-121)
import { describe, it, expect, afterEach, vi } from 'vitest'
import { renderComponent } from '../src/extra/testing.js'
import { createElement as h } from '../src/pragma/index.js'
import { Switchable, Collection, ABORT } from '../src/index.js'
import { event } from '../src/extra/reducers.js'
import { StateSource } from '../src/cycle/state/StateSource.js'
import xs from 'xstream'

let t
afterEach(() => { if (t) t.dispose(); t = null; vi.restoreAllMocks() })

const wait = (ms) => new Promise(r => setTimeout(r, ms))

// The eval's task-13 shape: three pages, one with intents and a list, switched by a tab bar
function HomePage({ state }) {
  return h('section', { className: 'home' }, h('h2', null, `Welcome back, ${state.name}!`))
}
function ProfilePage({ state }) {
  return h('section', { className: 'profile' },
    h('input', { className: 'name-input', value: state.name }),
    h('ul', { className: 'my-courses' }, ...state.courses.filter(c => c.enrolled).map(c => h('li', null, c.title))))
}
ProfilePage.intent = ({ DOM }) => ({ SET_NAME: DOM.input('.name-input').value() })
ProfilePage.model = { SET_NAME: (state, name) => ({ ...state, name }) }

function CoursesPage({ state }) {
  return h('section', { className: 'courses' },
    state.failed && h('button', { className: 'retry' }, 'Retry'),
    h('ul', null, ...state.courses.map(c => h('li', { className: 'course', data: { id: c.id } },
      h('span', null, `${c.seats} seats left`),
      c.enrolled ? h('button', { className: 'leave' }, 'Leave') : h('button', { className: 'enroll' }, 'Enroll')))))
}
CoursesPage.intent = ({ DOM }) => ({
  RETRY: DOM.click('.retry'),
  ENROLL: DOM.click('.enroll').data('id', Number),
  TRACK: DOM.click('.enroll').data('id', Number),
})
CoursesPage.model = {
  RETRY: { PARENT: () => 'retry' },
  ENROLL: (state, id) => ({ ...state, courses: state.courses.map(c => c.id === id ? { ...c, enrolled: true, seats: c.seats - 1 } : c) }),
  TRACK: { ANALYTICS: (_, id) => ({ enrolled: id }) },
}

const PAGES = ['home', 'profile', 'courses']
function App({ state }) {
  return h('div', null,
    h('nav', null, ...PAGES.map(p => h('button', { className: 'tab', data: { page: p } }, p))),
    h('span', { className: 'retries' }, `retries: ${state.retries}`),
    h('main', null, h(Switchable, { of: { home: HomePage, profile: ProfilePage, courses: CoursesPage }, current: state.page })))
}
App.initialState = {
  page: 'home', name: 'Ada', retries: 0, failed: true,
  courses: [{ id: 1, title: 'Intro to Rust', seats: 2, enrolled: false }, { id: 2, title: 'Go basics', seats: 3, enrolled: false }],
}
App.intent = ({ DOM, CHILD }) => ({
  OPEN_PAGE: DOM.click('.tab').data('page'),
  RETRY: CHILD.select(CoursesPage),
})
App.model = {
  OPEN_PAGE: (state, page) => (page === state.page ? ABORT : { ...state, page }),
  RETRY: (state) => ({ ...state, retries: state.retries + 1 }),
}

const analytics = () => {
  const seen = []
  const driver = (sink$) => { sink$.addListener({ next: v => seen.push(v), error() {}, complete() {} }); return { select: () => xs.never() } }
  return { seen, driver }
}

async function open(page) {
  t.simulateEvent(`.tab[data-page="${page}"]`, 'click')
  await t.next(s => s.page === page)
}

describe('G-120: Switchable forwards sinks that are not sources', () => {
  it("a switched page's PARENT reaches the parent's CHILD.select(Page)", async () => {
    t = renderComponent(App, { drivers: { ANALYTICS: analytics().driver } })
    await t.ready()
    await open('courses')
    t.simulateEvent('.retry', 'click')
    await t.next(s => s.retries === 1)
    expect(t.html()).toContain('retries: 1')
  })

  it('PARENT keeps reaching the parent across switches', async () => {
    t = renderComponent(App, { drivers: { ANALYTICS: analytics().driver } })
    await t.ready()
    for (let i = 1; i <= 3; i++) {
      await open('courses')
      t.simulateEvent('.retry', 'click')
      await t.next(s => s.retries === i)
      await open(i % 2 ? 'home' : 'profile')
    }
    await wait(20)
    // one PARENT value per click: no duplicated subscriptions after switching
    expect(t.states.at(-1).retries).toBe(3)
  })

  it("a custom driver sink from a switched page reaches the driver once per event", async () => {
    const a = analytics()
    t = renderComponent(App, { drivers: { ANALYTICS: a.driver } })
    await t.ready()
    await open('courses')
    t.simulateEvent('.course[data-id="2"] .enroll', 'click')
    await t.next(s => s.courses[1].enrolled)
    await open('home')
    await open('courses')
    t.simulateEvent('.course[data-id="1"] .enroll', 'click')
    await t.next(s => s.courses[0].enrolled)
    await wait(20)
    expect(a.seen).toEqual([{ enrolled: 2 }, { enrolled: 1 }])
  })
})

describe('G-121: Switchable shows the current page after every switch', () => {
  // In the evals the switchable stayed on the previous page after rapid switches (4/5 e2
  // task-13 trials). A hidden page's DOM chain was being torn down operator by operator
  // when it was switched back in, and the half-stopped chain never emitted again.
  it('60 rapid switches between three pages each render the current page', async () => {
    const bad = []
    for (let run = 0; run < 4; run++) {
      t = renderComponent(App, { drivers: { ANALYTICS: analytics().driver } })
      await t.ready()
      const order = ['profile', 'courses', 'profile', 'home', 'courses', 'home']
      for (let i = 0; i < 60; i++) {
        const page = order[i % order.length]
        await open(page)
        const shows = () => t.html().includes(`<section class="${page}"`)
        if (!shows()) { await wait(100); if (!shows()) bad.push([run, i, page, t.html().match(/<main>(<section class="\w+")/)?.[1]]) }
      }
      t.dispose(); t = null
    }
    expect(bad).toEqual([])
  }, 30000)

  it('a page switched back in shows the state changed while it was hidden', async () => {
    t = renderComponent(App, { drivers: { ANALYTICS: analytics().driver } })
    await t.ready()
    await open('courses')
    t.simulateEvent('.course[data-id="1"] .enroll', 'click')
    await t.next(s => s.courses[0].enrolled)
    await open('profile')
    t.simulateEvent('.name-input', 'input', { value: 'Grace' })
    await t.next(s => s.name === 'Grace')
    await open('home')
    await wait(20)
    expect(t.html()).toContain('Welcome back, Grace!')
    await open('profile')
    await wait(20)
    expect(t.html()).toContain('<li>Intro to Rust</li>')
  })
})

describe('G-121: hidden Switchable components', () => {
  it('a hidden page does not re-render on state changes; it renders the current state when shown', async () => {
    let homeRenders = 0
    function Home({ state }) { homeRenders++; return h('section', { className: 'home' }, `Hi ${state.name}`) }
    function Profile({ state }) { return h('section', { className: 'profile' }, h('input', { className: 'name-input', value: state.name })) }
    Profile.intent = ({ DOM }) => ({ SET_NAME: DOM.input('.name-input').value() })
    Profile.model = { SET_NAME: (state, name) => ({ ...state, name }) }
    function Tabs({ state }) {
      return h('div', null, h('button', { className: 'tab', data: { page: 'home' } }, 'home'), h('button', { className: 'tab', data: { page: 'profile' } }, 'profile'),
        h(Switchable, { of: { home: Home, profile: Profile }, current: state.page }))
    }
    Tabs.initialState = { page: 'home', name: 'Ada' }
    Tabs.intent = ({ DOM }) => ({ OPEN_PAGE: DOM.click('.tab').data('page') })
    Tabs.model = { OPEN_PAGE: (state, page) => (page === state.page ? ABORT : { ...state, page }) }

    t = renderComponent(Tabs)
    await t.ready()
    await open('profile')
    await wait(20)
    const before = homeRenders
    for (const name of ['G', 'Gr', 'Gra', 'Grace']) {
      t.simulateEvent('.name-input', 'input', { value: name })
      await t.next(s => s.name === name)
    }
    await wait(20)
    expect(homeRenders).toBe(before)
    await open('home')
    await wait(20)
    expect(t.html()).toContain('Hi Grace')
  })

  it("a page's sub-component keeps its own state across switches", async () => {
    function Counter({ state }) { return h('div', null, h('button', { className: 'inc' }, '+'), h('span', { className: 'count' }, String(state.count))) }
    Counter.initialState = { count: 0 }
    Counter.isolatedState = true
    Counter.intent = ({ DOM }) => ({ INC: DOM.click('.inc') })
    Counter.model = { INC: (state) => ({ ...state, count: state.count + 1 }) }
    function A() { return h('section', { className: 'a' }, h(Counter)) }
    function B() { return h('section', { className: 'b' }, 'b') }
    function Tabs({ state }) {
      return h('div', null, h('button', { className: 'tab', data: { page: 'a' } }, 'a'), h('button', { className: 'tab', data: { page: 'b' } }, 'b'),
        h(Switchable, { of: { a: A, b: B }, current: state.page }))
    }
    Tabs.initialState = { page: 'a' }
    Tabs.intent = ({ DOM }) => ({ OPEN_PAGE: DOM.click('.tab').data('page') })
    Tabs.model = { OPEN_PAGE: (state, page) => (page === state.page ? ABORT : { ...state, page }) }

    t = renderComponent(Tabs)
    await t.ready()
    t.simulateEvent('.inc', 'click')
    t.simulateEvent('.inc', 'click')
    await wait(30)
    expect(t.html()).toContain('<span class="count">2</span>')
    await open('b')
    await wait(30)
    await open('a')
    await wait(30)
    expect(t.html()).toContain('<span class="count">2</span>')
  })
})

// PLAN-2 4-R (R4-1): 3-F filtered a hidden page's state source, so its currentState stopped
// updating and its EVENTS/PARENT/EFFECT/context answers used the state from when it was hidden
describe('R4-1: a hidden page reads the current state', () => {
  it("a hidden page's EVENTS and PARENT answers use the state changed while it was hidden", async () => {
    function A({ state }) { return h('section', { className: 'a' }, `count ${state.count}`) }
    A.intent = ({ EVENTS }) => ({ PING: EVENTS.select('ping') })
    A.model = { PING: { EVENTS: event('pong', (state) => state.count), PARENT: (state) => state.count } }
    function B() { return h('section', { className: 'b' }, 'b') }
    function Tabs({ state }) {
      return h('div', null,
        h('button', { className: 'tab', data: { page: 'a' } }, 'a'), h('button', { className: 'tab', data: { page: 'b' } }, 'b'),
        h('button', { className: 'inc' }, '+'), h('button', { className: 'ping' }, 'ping'),
        h(Switchable, { of: { a: A, b: B }, current: state.page }))
    }
    Tabs.initialState = { page: 'a', count: 0, fromChild: [] }
    Tabs.intent = ({ DOM, CHILD }) => ({ OPEN_PAGE: DOM.click('.tab').data('page'), INC: DOM.click('.inc'), PING: DOM.click('.ping'), CHILDV: CHILD.select(A) })
    Tabs.model = {
      OPEN_PAGE: (state, page) => (page === state.page ? ABORT : { ...state, page }),
      INC: (state) => ({ ...state, count: state.count + 1 }),
      PING: { EVENTS: event('ping') },
      CHILDV: (state, v) => ({ ...state, fromChild: [...state.fromChild, v] }),
    }
    t = renderComponent(Tabs)
    await t.ready()
    await open('b')
    t.simulateEvent('.inc', 'click'); await t.next(s => s.count === 1)
    t.simulateEvent('.inc', 'click'); await t.next(s => s.count === 2)
    t.simulateEvent('.ping', 'click')
    await t.next(s => s.fromChild.length === 1)
    expect(t.state.fromChild).toEqual([2])
    expect(t.emitted.filter(e => e.type === 'pong').map(e => e.data)).toEqual([2])
    await open('a')
    await t.settle()
    expect(t.html()).toContain('count 2')
    t.simulateEvent('.inc', 'click'); await t.next(s => s.count === 3)
    t.simulateEvent('.ping', 'click')
    await t.next(s => s.fromChild.length === 2)
    expect(t.state.fromChild).toEqual([2, 3])
  })

  it("a hidden page's reducers and .context see the current state", async () => {
    const seen = []
    function A({ state, context }) { return h('section', { className: 'a' }, `n ${state.n} d ${context.doubled}`) }
    A.context = { doubled: (state) => state.n * 2 }
    A.intent = ({ EVENTS }) => ({ BUMP: EVENTS.select('bump') })
    A.model = {
      BUMP: (state) => { seen.push(state.n); return { ...state, n: state.n + 10 } },
    }
    function B() { return h('section', { className: 'b' }, 'b') }
    function Tabs({ state }) {
      return h('div', null,
        h('button', { className: 'tab', data: { page: 'a' } }, 'a'), h('button', { className: 'tab', data: { page: 'b' } }, 'b'),
        h('button', { className: 'inc' }, '+'), h('button', { className: 'bump' }, 'bump'),
        h(Switchable, { of: { a: A, b: B }, current: state.page }))
    }
    Tabs.initialState = { page: 'a', n: 0 }
    Tabs.intent = ({ DOM }) => ({ OPEN_PAGE: DOM.click('.tab').data('page'), INC: DOM.click('.inc'), BUMP: DOM.click('.bump') })
    Tabs.model = {
      OPEN_PAGE: (state, page) => (page === state.page ? ABORT : { ...state, page }),
      INC: (state) => ({ ...state, n: state.n + 1 }),
      BUMP: { EVENTS: event('bump') },
    }
    t = renderComponent(Tabs)
    await t.ready()
    await open('b')
    t.simulateEvent('.inc', 'click'); await t.next(s => s.n === 1)
    t.simulateEvent('.bump', 'click'); await t.next(s => s.n === 11)
    expect(seen).toEqual([1])
    await open('a')
    await t.settle()
    expect(t.html()).toContain('n 11 d 22')
  })

  it('a Collection in a hidden page shows the items changed while it was hidden', async () => {
    function Item({ state }) { return h('li', { className: 'item' }, state.title) }
    function List() { return h('section', { className: 'list' }, h('ul', null, h(Collection, { of: Item, from: 'items' }))) }
    function B() { return h('section', { className: 'b' }, 'b') }
    function Tabs({ state }) {
      return h('div', null,
        h('button', { className: 'tab', data: { page: 'list' } }, 'l'), h('button', { className: 'tab', data: { page: 'b' } }, 'b'),
        h('button', { className: 'add' }, '+'), h('button', { className: 'del' }, '-'),
        h(Switchable, { of: { list: List, b: B }, current: state.page }))
    }
    Tabs.initialState = { page: 'list', items: [{ id: 1, title: 'one' }] }
    Tabs.intent = ({ DOM }) => ({ OPEN_PAGE: DOM.click('.tab').data('page'), ADD: DOM.click('.add'), DEL: DOM.click('.del') })
    Tabs.model = {
      OPEN_PAGE: (state, page) => (page === state.page ? ABORT : { ...state, page }),
      ADD: (state) => ({ ...state, items: [...state.items, { id: state.items.length + 1, title: 'n' + (state.items.length + 1) }] }),
      DEL: (state) => ({ ...state, items: state.items.slice(1) }),
    }
    t = renderComponent(Tabs)
    await t.ready()
    await open('b')
    t.simulateEvent('.add', 'click'); await t.next(s => s.items.length === 2)
    t.simulateEvent('.del', 'click'); await t.next(s => s.items.length === 1)
    await open('list')
    await t.settle()
    expect(t.html()).toContain('<li class="item">n2</li>')
    expect(t.html()).not.toContain('>one<')
  })

  it('nested Switchables: an inner page hidden by the outer switch skips renders and catches up when shown', async () => {
    let innerRenders = 0
    function X({ state }) { innerRenders++; return h('p', { className: 'x' }, `x ${state.n}`) }
    function Y() { return h('p', { className: 'y' }, 'y') }
    function Outer({ state }) { return h('section', { className: 'outer' }, h(Switchable, { of: { x: X, y: Y }, current: state.inner })) }
    function Other() { return h('section', { className: 'other' }, 'other') }
    function Tabs({ state }) {
      return h('div', null,
        h('button', { className: 'tab', data: { page: 'outer' } }, 'o'), h('button', { className: 'tab', data: { page: 'other' } }, 'b'),
        h('button', { className: 'inc' }, '+'),
        h(Switchable, { of: { outer: Outer, other: Other }, current: state.page }))
    }
    Tabs.initialState = { page: 'outer', inner: 'x', n: 0 }
    Tabs.intent = ({ DOM }) => ({ OPEN_PAGE: DOM.click('.tab').data('page'), INC: DOM.click('.inc') })
    Tabs.model = {
      OPEN_PAGE: (state, page) => (page === state.page ? ABORT : { ...state, page }),
      INC: (state) => ({ ...state, n: state.n + 1 }),
    }
    t = renderComponent(Tabs)
    await t.ready()
    await t.settle()
    expect(t.html()).toContain('x 0')
    await open('other')
    await t.settle()
    const before = innerRenders
    t.simulateEvent('.inc', 'click'); await t.next(s => s.n === 1)
    t.simulateEvent('.inc', 'click'); await t.next(s => s.n === 2)
    await t.settle()
    expect(innerRenders).toBe(before)
    await open('outer')
    await t.settle()
    expect(t.html()).toContain('x 2')
  })
})

describe('R4-10: a page switched back in never shows its old output', () => {
  // (R5: the switchable() factory's remembered-output cases went with the old core; the tree case
  // below pins the behaviour)
  it('in a component tree, the old content of a page changed while hidden is never rendered', async () => {
    function A({ state }) { return h('section', { className: 'a' }, `count ${state.count}`) }
    function B() { return h('section', { className: 'b' }, 'b') }
    function Tabs({ state }) {
      return h('div', null,
        h('button', { className: 'tab', data: { page: 'a' } }, 'a'), h('button', { className: 'tab', data: { page: 'b' } }, 'b'),
        h('button', { className: 'inc' }, '+'),
        h(Switchable, { of: { a: A, b: B }, current: state.page }))
    }
    Tabs.initialState = { page: 'a', count: 0 }
    Tabs.intent = ({ DOM }) => ({ OPEN_PAGE: DOM.click('.tab').data('page'), INC: DOM.click('.inc') })
    Tabs.model = {
      OPEN_PAGE: (state, page) => (page === state.page ? ABORT : { ...state, page }),
      INC: (state) => ({ ...state, count: state.count + 1 }),
    }
    t = renderComponent(Tabs)
    await t.ready()
    await open('b')
    await t.settle()
    t.simulateEvent('.inc', 'click'); await t.next(s => s.count === 1)
    await t.settle()
    const seen = []
    const poll = setInterval(() => seen.push(t.html()), 0)
    await open('a')
    await t.settle()
    clearInterval(poll)
    seen.push(t.html())
    expect(seen.filter(x => x.includes('count 0'))).toEqual([])
    expect(t.html()).toContain('count 1')
  })
})

