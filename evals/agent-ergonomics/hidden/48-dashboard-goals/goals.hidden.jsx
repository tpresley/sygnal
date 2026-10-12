import { describe, it, expect, afterEach } from 'vitest'
import { renderComponent } from 'sygnal'
import { composeWith } from 'sygnal/ai'
import { textOf } from './queries.js'
import App from '../src/App.jsx'
import { catalog } from '../src/catalog.js'

// PLAN-9 p9 tier. No model: the app runs with renderComponent on the real DOM (jsdom), and
// composeWith answers each pending composition with the backend's own fake reply, as the
// decision model would. The test only names what the prompt fixes: the part `goals`, its
// `period` setting (`week` | `month`), the header's "N of M goals done", the goal texts.

const WEEK = ['Ship the billing page', 'Answer every open support ticket']
const MONTH = ['Hire a product designer', 'Launch the mobile beta', 'Close the Q3 books']

let t
afterEach(() => { t?.dispose(); t = null })

async function open() {
  t = renderComponent(App, { dom: 'real' })
  await t.ready()
  await t.settle()
}

/** compose the page from a request; `tree` is what the model answers with */
async function compose(prompt, tree) {
  t.simulateAction('page.COMPOSE', prompt)
  await t.settle()
  await composeWith(t, catalog, tree)
  await t.waitForState((s) => s.page.status === 'done')
  await t.settle()
}

const header = () => textOf(t.container.querySelector('.goal-count'))
const canvasText = () => textOf(t.container.querySelector('.canvas') ?? t.container)

/** the checkbox whose label (or row) names this goal */
function box(text) {
  const all = [...t.container.querySelectorAll('input[type="checkbox"]')].filter((el) => {
    const name = [...(el.labels ?? [])].map(textOf).join(' ') || el.getAttribute('aria-label') || textOf(el.closest('li, tr, div') ?? el)
    return name.includes(text)
  })
  if (all.length !== 1) throw new Error(`expected one checkbox for "${text}", found ${all.length}`)
  return all[0]
}

async function toggle(text) {
  box(text).click()
  await t.settle()
}

describe('dashboard goals part', () => {
  it("composes this month's goals as checkboxes, with their done state", async () => {
    await open()
    expect(header()).toContain('1 of 5 goals done')
    await compose("This month's goals", [{ part: 'goals', params: { period: 'month' } }])
    for (const g of MONTH) expect(canvasText()).toContain(g)
    for (const g of WEEK) expect(canvasText()).not.toContain(g)
    for (const g of MONTH) expect(box(g).checked).toBe(false)
  })

  it("shows this week's goals by default", async () => {
    await open()
    await compose('My goals', [{ part: 'goals' }])
    for (const g of WEEK) expect(canvasText()).toContain(g)
    for (const g of MONTH) expect(canvasText()).not.toContain(g)
    expect(box('Answer every open support ticket').checked).toBe(true)
    expect(box('Ship the billing page').checked).toBe(false)
  })

  it("ticking and unticking a goal changes the app's goals (the header follows)", async () => {
    await open()
    await compose("This month's goals", [{ part: 'goals', params: { period: 'month' } }])
    await toggle('Hire a product designer')
    expect(box('Hire a product designer').checked).toBe(true)
    expect(header()).toContain('2 of 5 goals done')
    expect(t.state.goals.find((g) => g.text === 'Hire a product designer').done).toBe(true)
    await toggle('Launch the mobile beta')
    expect(header()).toContain('3 of 5 goals done')
    await toggle('Hire a product designer')
    expect(box('Hire a product designer').checked).toBe(false)
    expect(header()).toContain('2 of 5 goals done')
  })

  it('a tick survives a follow-up edit of the page', async () => {
    await open()
    await compose("This month's goals", [{ part: 'goals', params: { period: 'month' } }])
    await toggle('Launch the mobile beta')
    await compose('Put revenue above the goals', [{ part: 'revenue' }, { part: 'goals', params: { period: 'month' } }])
    expect(canvasText()).toContain('Revenue this month')
    expect(box('Launch the mobile beta').checked).toBe(true)
    expect(header()).toContain('2 of 5 goals done')
    // still working after the edit
    await toggle('Close the Q3 books')
    expect(header()).toContain('3 of 5 goals done')
  })

  it('a tick survives a new page and the goals being removed and asked for again', async () => {
    await open()
    await compose('My goals', [{ part: 'goals' }])
    await toggle('Ship the billing page')
    expect(header()).toContain('2 of 5 goals done')
    // start over: a new composition
    t.simulateAction('page.COMPOSE', { prompt: 'Revenue and signups', fresh: true })
    await t.settle()
    await composeWith(t, catalog, [{ part: 'revenue' }, { part: 'signups' }])
    await t.waitForState((s) => s.page.status === 'done' && s.page.prompt === 'Revenue and signups')
    await t.settle()
    expect(canvasText()).not.toContain('Ship the billing page')
    expect(header()).toContain('2 of 5 goals done')
    await compose("This week's goals", [{ part: 'goals', params: { period: 'week' } }])
    expect(box('Ship the billing page').checked).toBe(true)
    expect(box('Answer every open support ticket').checked).toBe(true)
    expect(header()).toContain('2 of 5 goals done')
  })

  it('switching the period keeps the ticks of both periods', async () => {
    await open()
    await compose('My goals', [{ part: 'goals' }])
    await toggle('Ship the billing page')
    await compose('Show the goals for the month instead', [{ part: 'goals', params: { period: 'month' } }])
    for (const g of MONTH) expect(canvasText()).toContain(g)
    expect(canvasText()).not.toContain('Ship the billing page')
    await toggle('Close the Q3 books')
    expect(header()).toContain('3 of 5 goals done')
    await compose('Back to this week', [{ part: 'goals', params: { period: 'week' } }])
    expect(box('Ship the billing page').checked).toBe(true)
  })

  it('the other parts still work, also next to the goals', async () => {
    await open()
    await compose('Pending orders and the month goals', [
      { part: 'orders', params: { status: 'pending' } },
      { part: 'goals', params: { period: 'month' } },
    ])
    expect(canvasText()).toContain('Pending orders')
    expect(canvasText()).toContain('Globex')
    expect(canvasText()).not.toContain('Northwind')
    expect(canvasText()).toContain('Hire a product designer')
  })
})
