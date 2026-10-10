import { describe, it, expect, afterEach, vi } from 'vitest'
import { mountApp, click, textOf, getByText, queryByText, waitFor } from './dom.js'
import { aiServer, answersFor } from './aiserver.js'

// POST /api/decide is a fake decision route and POST /api/chat a fake AI SDK 7 route
// (aiserver.js): every request stays pending until the test answers it.

afterEach(() => vi.unstubAllGlobals())

const TEXTS = {
  1: 'I was charged twice for my March invoice.',
  2: 'The CSV export crashes the app',
  3: 'the password reset link says it has expired',
  4: 'My card was declined at checkout',
}
const SUBJECTS = { 1: 'Charged twice', 2: 'Export crashes', 3: 'Locked out', 4: 'Something is off' }

const ticket = (n) => [...document.querySelectorAll('.ticket')].find((el) => textOf(el).includes(SUBJECTS[n]))
const topic = (n) => textOf(ticket(n).querySelector('.topic'))
const urgent = (n) => { const u = ticket(n).querySelector('.urgent'); return u ? textOf(u) : null }
const urgentCount = () => textOf(document.querySelector('.urgent-count'))
const TRIAGING = /^Triaging(…|\.\.\.)$/
const ASKING = /^Asking the assistant(…|\.\.\.)$/

async function open() {
  const server = aiServer()
  await mountApp()
  return server
}

/** the pending decision requests, by ticket number (all four must have been sent) */
async function decisions(server, count = 4) {
  return waitFor(() => {
    const all = server.all('/api/decide').filter((r) => !r.taken)
    if (all.length < count) throw new Error(`expected ${count} decision requests, got ${all.length}`)
    const by = {}
    for (const r of all) {
      const n = Object.keys(TEXTS).find((k) => JSON.stringify(r.body?.state ?? '').includes(TEXTS[k]))
      if (!n) throw new Error(`a decision request for no known ticket: ${JSON.stringify(r.body?.state)}`)
      r.taken = true
      by[n] = r
    }
    return by
  })
}

describe('ticket triage', () => {
  it('sends one decision request per ticket at once, in the dictionary form', async () => {
    const server = await open()
    const by = await decisions(server)
    expect(Object.keys(by).sort()).toEqual(['1', '2', '3', '4'])
    for (const n of [1, 2, 3, 4]) expect(topic(n)).toMatch(TRIAGING)
    const body = by[2].body
    expect(by[2].method).toBe('POST')
    expect(body.model).toBe('jev-latest')
    expect(body.questions.topic.type).toBe('choice')
    expect(Object.keys(body.questions.topic.criteria).sort()).toEqual(['account', 'billing', 'bug'])
    expect(typeof body.questions.topic.instructions === 'string' || typeof body.questions.topic.instructions === 'object').toBe(true)
    expect(body.questions.urgent.type).toBe('noul')
    expect(Object.keys(body.questions.urgent.criteria ?? {}).sort()).toEqual(['false', 'true'])
  })

  it('shows confident topics and urgent flags, and asks the chat model nothing', async () => {
    const server = await open()
    const by = await decisions(server)
    expect(urgentCount()).toBe('0 urgent')
    await by[1].json(answersFor({ topic: ['billing', 0.82], urgent: 0.3 }))
    await by[2].json(answersFor({ topic: ['bug', 0.95], urgent: 0.9 }))
    await by[3].json(answersFor({ topic: ['account', 0.6], urgent: 0.5 }))
    await waitFor(() => expect([topic(1), topic(2), topic(3)]).toEqual(['Billing', 'Bug', 'Account']))
    expect(topic(4)).toMatch(TRIAGING)
    expect([urgent(1), urgent(2), urgent(3)]).toEqual([null, 'Urgent', 'Urgent'])
    expect(urgentCount()).toBe('2 urgent')
    expect(await server.noneWithin('/api/chat', 300), 'confident tickets never go to the chat model').toBe(true)
    await by[4].json(answersFor({ topic: ['billing', 0.71], urgent: 0.8 }))
    await waitFor(() => expect(topic(4)).toBe('Billing'))
    expect(urgentCount()).toBe('3 urgent')
    expect(server.count('/api/chat')).toBe(0)
  })

  it('escalates an unsure ticket to the chat model', async () => {
    const server = await open()
    const by = await decisions(server)
    await by[4].json(answersFor({ topic: ['billing', 0.35], urgent: 0.8 }))
    await waitFor(() => expect(topic(4)).toMatch(ASKING))
    expect(urgent(4), 'the urgent flag comes from the decision').toBe('Urgent')
    const chat = await server.next('/api/chat')
    const users = chat.messages.filter((m) => m.role === 'user')
    expect(users.length, 'one user message').toBe(1)
    expect(chat.lastUserText()).toContain('My card was declined at checkout, but the money still left my bank account.')
    expect(chat.lastUserText().toLowerCase()).toMatch(/billing/)
    await chat.reply(['Bill', 'ing.'])
    await waitFor(() => expect(topic(4)).toBe('Billing (assistant)'))
    expect(urgentCount()).toBe('1 urgent')
    expect(await server.noneWithin('/api/chat', 200)).toBe(true)
    for (const n of [1, 2, 3]) expect(topic(n)).toMatch(TRIAGING)
  })

  it('an unusable chat reply or a failed chat request needs review', async () => {
    const server = await open()
    const by = await decisions(server)
    await by[4].json(answersFor({ topic: ['billing', 0.35], urgent: 0.2 }))
    const first = await server.next('/api/chat')
    await by[1].json(answersFor({ topic: ['billing', 0.55], urgent: 0.1 }))
    const second = await server.next('/api/chat')
    const [forFour, forOne] = first.lastUserText().includes(TEXTS[4]) ? [first, second] : [second, first]
    expect(forOne.lastUserText()).toContain(TEXTS[1])
    await forFour.reply(['It looks like a payment problem to me.'])
    await waitFor(() => expect(topic(4)).toBe('Needs review'))
    await forOne.fail(500)
    await waitFor(() => expect(topic(1)).toBe('Needs review'))
    expect([urgent(1), urgent(4)]).toEqual([null, null])
    await by[2].json(answersFor({ topic: ['bug', 0.9], urgent: 0.1 }))
    await waitFor(() => expect(topic(2)).toBe('Bug'))
  })

  it('a failed decision can be retried, for that ticket only', async () => {
    const server = await open()
    const by = await decisions(server)
    await by[2].fail(500)
    await by[3].networkError()
    await waitFor(() => expect(topic(2)).toBe('Could not triage.'))
    await waitFor(() => expect(topic(3)).toBe('Could not triage.'))
    expect(queryByText('button', /^Retry$/, ticket(1)), 'no Retry on a ticket that did not fail').toBeNull()
    await by[1].json(answersFor({ topic: ['billing', 0.9], urgent: 0.1 }))
    await waitFor(() => expect(topic(1)).toBe('Billing'))

    await click(getByText('button', /^Retry$/, ticket(2)))
    expect(topic(2)).toMatch(TRIAGING)
    const again = await decisions(server, 1)
    expect(Object.keys(again)).toEqual(['2'])
    expect(await server.noneWithin('/api/decide', 250), 'only that ticket is sent again').toBe(true)
    expect(topic(3)).toBe('Could not triage.')
    await again[2].json(answersFor({ topic: ['bug', 0.92], urgent: 0.95 }))
    await waitFor(() => expect(topic(2)).toBe('Bug'))
    expect(urgentCount()).toBe('1 urgent')

    await click(getByText('button', /^Retry$/, ticket(3)))
    const third = await decisions(server, 1)
    await third[3].json(answersFor({ topic: ['account', 0.88], urgent: 0.7 }))
    await waitFor(() => expect(topic(3)).toBe('Account'))
    expect(urgentCount()).toBe('2 urgent')
  })
})
