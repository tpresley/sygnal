// PLAN-2 3-F: Switchable bugs found by the Phase 3 evals (G-120, G-121)
import { describe, it, expect, afterEach, vi } from 'vitest'
import { renderComponent } from '../src/extra/testing.js'
import { createElement as h } from '../src/pragma/index.js'
import { Switchable, ABORT } from '../src/index.js'
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
