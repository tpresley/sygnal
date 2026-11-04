// The filter wizard, tested through the app: renderComponent with the router (an in-memory
// history), a real DOM (jsdom; renderComponent adds the <dialog> methods jsdom lacks), and the
// HTTP fake (t.requests / t.respond).
import { describe, it, expect, afterEach } from 'vitest'
import { renderComponent, makeFetchDriver } from 'sygnal'
import App from './App.jsx'
import Review from './new-filter/Review.jsx'
import Created from './new-filter/Created.jsx'
import { router } from './routes.js'
import { BLANK } from './filters.js'
import { fakeApi } from './api.js'

let t
afterEach(() => { t?.dispose(); t = null })

const start = async (url, options = {}) => {
  t = renderComponent(App, { dom: 'real', router, url, ...options })
  await t.ready()
  await t.settle()
  return t
}
const type = async (sel, value) => {
  const el = t.query(sel)
  el.value = value
  el.dispatchEvent(new Event('input', { bubbles: true }))
  await t.settle()
}
const choose = async (sel, value) => {
  const el = t.queryAll(sel).find((e) => e.value === value)
  if (el.type === 'radio') el.checked = true
  else el.value = value
  el.dispatchEvent(new Event('change', { bubbles: true }))
  await t.settle()
}
const click = async (sel) => { t.query(sel).click(); await t.settle() }
const heading = () => t.query('.step h2')?.textContent
const stepper = () => t.queryAll('.stepper li').map((li) => `${li.querySelector('button, span').textContent}:${li.dataset.status}`)
const wizardState = () => t.state.flow.wizard
const dialogOpen = () => t.query('.leave-dialog').hasAttribute('open')

// Describe filled in: a name, the logs source
const describe1 = async (name = 'Login failures') => {
  await type('.name', name)
  await click('.next')
}

describe('the steps', () => {
  it('Next and Back move through the steps; the step is in the URL; the draft is shared', async () => {
    await start('/filters/new')
    expect(heading()).toBe('Describe the filter')
    expect(stepper()).toEqual(['Describe:current', 'Configure:blocked', 'Review:blocked'])
    // Describe isn't valid yet: Next is disabled
    expect(t.query('.next').disabled).toBe(true)

    await describe1()
    expect(t.location.path).toBe('/filters/new/keywords')
    expect(heading()).toBe('Which log lines?')
    expect(stepper()).toEqual(['Describe:done', 'Configure:current', 'Review:blocked'])

    await type('.keywords', 'login, failed')
    await click('.next')
    expect(t.location.path).toBe('/filters/new/review')
    expect(t.query('.summary-name').textContent).toBe('Login failures')
    expect(t.query('.summary-condition').textContent).toBe('log lines with “login” or “failed”')
    expect(t.query('.next')).toBe(null)   // Review has its own Create button

    await click('.back')
    expect(t.location.path).toBe('/filters/new/keywords')
    expect(t.query('.keywords').value).toBe('login, failed')
  })

  it("the browser's Back and Forward move between steps", async () => {
    await start('/filters/new')
    await describe1()
    await type('.keywords', 'login')
    await click('.next')
    expect(wizardState().step).toBe('review')

    await t.back()
    await t.settle()
    expect(wizardState().step).toBe('keywords')
    await t.back()
    await t.settle()
    expect(wizardState().step).toBe('describe')
    expect(t.query('.name').value).toBe('Login failures')
    await t.forward()
    await t.settle()
    expect(wizardState().step).toBe('keywords')
  })

  it('a step skipped by `when`: a metrics filter has Threshold instead of Keywords, under the same stepper entry', async () => {
    await start('/filters/new')
    await type('.name', 'Hot CPU')
    await choose('.source', 'metrics')
    await click('.next')
    expect(t.location.path).toBe('/filters/new/threshold')
    expect(heading()).toBe('Which values?')
    expect(stepper()).toEqual(['Describe:done', 'Configure:current', 'Review:blocked'])
    expect(wizardState().steps.find((s) => s.name === 'keywords').status).toBe('skipped')

    await type('.above', '90')
    await click('.next')
    expect(t.query('.summary-condition').textContent).toBe('CPU % above 90')
  })

  it('the stepper goes back to a done step; a step moves the flow itself (Review: Change the name)', async () => {
    await start('/filters/new')
    await describe1()
    await type('.keywords', 'login')
    await click('.next')

    await click('.goto[data-step="keywords"]')
    expect(t.location.path).toBe('/filters/new/keywords')
    await click('.next')
    await click('.rename')
    expect(t.location.path).toBe('/filters/new/describe')
    expect(t.query('.name').value).toBe('Login failures')
  })

  it('Start over: a new draft, at the first step', async () => {
    await start('/filters/new')
    await describe1()
    await click('.start-over')
    expect(t.location.path).toBe('/filters/new')
    expect(t.query('.name').value).toBe('')
    expect(wizardState().draft).toEqual(BLANK)
  })
})

describe('links into the flow', () => {
  it('a deep link to a later step goes to the first step that is incomplete', async () => {
    await start('/filters/new/review')
    expect(t.location.path).toBe('/filters/new/describe')
    expect(heading()).toBe('Describe the filter')

    // with Describe done, a link to Review stops at Configure (no keywords yet)
    await type('.name', 'Login failures')
    await t.navigate('/filters/new/review')
    await t.settle()
    expect(t.location.path).toBe('/filters/new/keywords')
    // and a link to the alternative that doesn't apply goes to the one that does
    await t.navigate('/filters/new/threshold')
    await t.settle()
    expect(t.location.path).toBe('/filters/new/keywords')
  })

  it('a reload lands on the same step, with the draft (the flow is persisted for the tab)', async () => {
    const storage = {}
    await start('/filters/new', { storage })
    await describe1()
    await type('.keywords', 'login')
    await click('.next')
    expect(t.location.path).toBe('/filters/new/review')
    t.dispose()

    // the same tab storage, the same URL: a reload
    await start('/filters/new/review', { storage })
    expect(t.location.path).toBe('/filters/new/review')
    expect(t.query('.summary-name').textContent).toBe('Login failures')
  })

  it('entering the wizard from another page starts a new flow', async () => {
    await start('/filters/new')
    await type('.name', 'Half done')
    await t.navigate('/')
    await t.settle()
    await click('.discard')
    expect(t.location.path).toBe('/')

    await click('.new-filter')
    expect(t.location.path).toBe('/filters/new')
    expect(t.query('.name').value).toBe('')
  })
})

describe('the leave guard', () => {
  it('leaving with something typed asks first: Keep editing stays, Discard leaves', async () => {
    await start('/filters/new')
    await type('.name', 'Unsaved')

    // a link out of the flow (the header's) is held
    await click('.home')
    expect(t.location.path).toBe('/filters/new')
    expect(dialogOpen()).toBe(true)
    expect(t.query('#leave-title').textContent).toBe('Discard this filter?')

    await click('.stay')
    expect(dialogOpen()).toBe(false)
    expect(t.location.path).toBe('/filters/new')
    expect(t.query('.name').value).toBe('Unsaved')

    // moves inside the flow are never held
    await click('.next')
    expect(t.location.path).toBe('/filters/new/keywords')
    expect(dialogOpen()).toBe(false)

    // the back button out of the flow is held too; Discard makes the navigation
    await t.navigate('/')
    await t.settle()
    expect(dialogOpen()).toBe(true)
    await click('.discard')
    expect(t.location.path).toBe('/')
    expect(t.query('h1').textContent).toBe('Filters')   // the wizard page (and its dialog) is gone
  })

  it('nothing typed: nothing to lose, so leaving is not held', async () => {
    await start('/filters/new')
    await click('.home')
    expect(t.location.path).toBe('/')
  })

  it('the dialog copy follows the step', async () => {
    await start('/filters/new')
    await describe1()
    await type('.keywords', 'login')
    await click('.next')
    await t.navigate('/')
    await t.settle()
    expect(t.query('#leave-title').textContent).toBe('Discard this filter?')
    expect(t.query('.leave-dialog p').textContent).toBe('It isn’t created yet: what you entered will be lost.')
  })
})

describe('creating the filter', () => {
  const toReview = async () => {
    await start('/filters/new')
    await describe1()
    await type('.keywords', 'login, failed')
    await click('.next')
  }

  it('Review creates it; Created then counts its matches from the draft, once', async () => {
    await toReview()
    await click('.create')
    expect(t.query('.create').textContent).toBe('Creating…')
    expect(t.requests('HTTP').at(-1)).toMatchObject({ url: '/api/filters', json: { name: 'Login failures', source: 'logs', keywords: 'login, failed' } })

    await t.respond('HTTP', { id: 3, name: 'Login failures', source: 'logs', keywords: 'login, failed' }, 'CREATED')
    await t.settle()
    // the outcome: the flow took the new filter's id as its key
    expect(t.location.path).toBe('/filters/new/created')
    expect(t.location.query).toEqual({ filter: '3' })
    expect(heading()).toBe('Filter created')
    expect(wizardState()).toMatchObject({ outcome: 'created', key: '3', canBack: false })
    expect(stepper()).toEqual(['Describe:done', 'Configure:done', 'Review:done'])
    expect(t.query('.moves')).toBe(null)

    // Created's BOOTSTRAP sent the count, and cleared the flag
    expect(t.requests('HTTP').at(-1)).toMatchObject({ url: '/api/filters/3/preview', method: 'POST' })
    expect(wizardState().draft.created).toEqual({ id: 3, countMatches: false })
    expect(t.query('.matches').textContent).toBe('Counting matches in the last hour…')
    await t.respond('HTTP', { matches: 12 }, 'COUNTED')
    expect(t.query('.matches').textContent).toBe('12 matches in the last hour.')

    // no way back into the steps, and nothing to lose: leaving isn't held
    await t.back()
    await t.settle()
    expect(t.location.path).toBe('/filters/new/created')
    await click('.open')
    expect(t.location.path).toBe('/filters/3')
  })

  it('a failed create stays on Review with the error', async () => {
    await toReview()
    await click('.create')
    await t.fail('HTTP', { status: 422 }, 'CREATE_FAILED')
    await t.settle()
    expect(t.location.path).toBe('/filters/new/review')
    expect(t.query('.create').disabled).toBe(false)
    expect(t.query('.error').textContent).toBe('The filter wasn’t created (422).')
  })

  it('Create a similar filter: a new flow from a copy of the draft', async () => {
    await toReview()
    await click('.create')
    await t.respond('HTTP', { id: 3 }, 'CREATED')
    await t.settle()
    await click('.similar')
    expect(t.location.path).toBe('/filters/new')
    expect(t.location.query).toEqual({})
    expect(wizardState()).toMatchObject({ step: 'describe', key: null })
    expect(t.query('.name').value).toBe('Login failures (copy)')
  })

  it('end to end against the fake API: the new filter is in the list, with its count', async () => {
    const api = fakeApi({ latency: 1 })
    await start('/filters/new', { drivers: { HTTP: makeFetchDriver({ fetch: api }) } })
    await describe1('Disk full')
    await type('.keywords', 'ENOSPC')
    await click('.next')
    await click('.create')
    await t.waitForState((s) => s.flow.wizard.local.created?.matches != null, 1000)
    expect(t.query('.matches').textContent).toBe(`${api.db[2].matches} matches in the last hour.`)

    await click('.open')
    await t.waitForState((s) => s.filter?.status === 'success', 1000)
    expect(t.query('h1').textContent).toBe('Disk full')
    expect(t.query('.condition').textContent).toBe('log lines with “ENOSPC”')

    // New filter from the list: a new flow at Describe, not Created again (restart: 'outcome')
    await t.navigate('/')
    await t.settle()
    await click('.new-filter')
    expect(t.location.path).toBe('/filters/new')
    expect(wizardState()).toMatchObject({ step: 'describe', outcome: null, key: null })
    expect(t.query('.name').value).toBe('')
  })
})

describe('a step alone', () => {
  const draft = { ...BLANK, name: 'Login failures', keywords: 'login' }

  it("Review's wizard messages are in t.sent('PARENT')", async () => {
    t = renderComponent(Review, { dom: 'real', initialState: { draft, creating: false, error: null } })
    await t.ready()
    await click('.rename')
    expect(t.sent('PARENT')).toEqual([{ wizard: 'GOTO', step: 'describe' }])
  })

  it('Created counts the matches only when the draft asks for it', async () => {
    t = renderComponent(Created, { dom: 'real', initialState: { draft: { ...draft, created: { id: 5, countMatches: true } }, matches: null, error: null } })
    await t.ready()
    await t.settle()
    expect(t.requests('HTTP').map((r) => r.url)).toEqual(['/api/filters/5/preview'])
    t.dispose()

    t = renderComponent(Created, { dom: 'real', initialState: { draft: { ...draft, created: { id: 5, countMatches: false } }, matches: 4, error: null } })
    await t.ready()
    await t.settle()
    expect(t.requests('HTTP')).toEqual([])
    expect(t.query('.matches').textContent).toBe('4 matches in the last hour.')
  })
})
