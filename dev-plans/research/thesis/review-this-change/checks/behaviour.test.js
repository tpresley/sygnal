// One black-box spec for both arms: real DOM events in jsdom, a stubbed network, the app's real
// entry. The same assertions run against the React and the Sygnal app, and against each change.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import mount from '@mount'

const variant = process.env.VARIANT ?? 'base'
const SEED = [
  { id: 't1', subject: 'Refund not received', body: 'Order 4411.', status: 'open', priority: 'high', customerEmail: 'ana@example.com' },
  { id: 't2', subject: 'Cannot log in', body: 'Reset link expired.', status: 'open', priority: 'low', customerEmail: 'ben@example.com' },
  { id: 't3', subject: 'Invoice copy', body: 'For March.', status: 'closed', priority: 'low', customerEmail: 'cy@example.com' },
]

let dispose, calls, tickets

const $ = (s) => document.querySelector(s)
const $$ = (s) => [...document.querySelectorAll(s)]
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const settle = () => sleep(25)
async function until(fn, label) {
  for (let i = 0; i < 100; i++) {
    if (fn()) return
    await sleep(5)
  }
  throw new Error(`timed out: ${label}`)
}
const click = async (s) => { $(s).dispatchEvent(new MouseEvent('click', { bubbles: true })); await settle() }
async function type(s, text) {
  const el = $(s)
  const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, text)
  el.dispatchEvent(new Event('input', { bubbles: true }))
  await settle()
}
const posts = () => calls.filter((c) => c.method !== 'GET' && c.url.startsWith('/api/'))

beforeEach(async () => {
  calls = []
  tickets = SEED.map((t) => ({ ...t }))
  globalThis.fetch = async (url, init = {}) => {
    const u = typeof url === 'string' ? url : url.url ?? String(url)
    const method = init.method ?? (typeof url === 'object' ? url.method : undefined) ?? 'GET'
    const path = u.replace(/^https?:\/\/[^/]+/, '')
    calls.push({ method, url: path })
    let body = {}
    if (path === '/api/tickets') body = tickets
    const close = path.match(/^\/api\/tickets\/(\w+)\/close$/)
    if (close) {
      const t = tickets.find((x) => x.id === close[1])
      t.status = 'closed'
      body = t
    }
    return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }
  document.body.innerHTML = '<div id="root"></div>'
  dispose = mount('#root')
  await until(() => $$('.ticket').length > 0, 'tickets listed')
})

afterEach(() => { dispose?.(); document.body.innerHTML = '' })

describe(`inbox (${process.env.ARM}, ${variant})`, () => {
  it('lists the open tickets', () => {
    const listed = $$('.ticket').map((b) => b.textContent).join('|')
    expect(listed).toContain('Refund not received')
    expect(listed).not.toContain('Invoice copy')
  })

  it('selecting a ticket sends nothing over the network', async () => {
    const before = calls.length
    await click('.ticket[data-id=t1]')
    expect(calls.slice(before)).toEqual([])
  })

  it('sends a reply once and clears the draft', async () => {
    await click('.ticket[data-id=t1]')
    await type('.reply', 'On its way')
    await click('.send')
    expect(posts()).toEqual([{ method: 'POST', url: '/api/tickets/t1/replies' }])
    await until(() => $('.reply').value === '', 'draft cleared')
  })

  it('does not send a blank reply', async () => {
    await click('.ticket[data-id=t1]')
    await type('.reply', '   ')
    await click('.send')
    expect(posts()).toEqual([])
  })

  it('does not send a reply on a closed ticket', async () => {
    await click('.folder[data-folder=closed]')
    await click('.ticket[data-id=t3]')
    await type('.reply', 'One more thing')
    await click('.send')
    expect(posts()).toEqual([])
  })

  it('closes a ticket with no draft', async () => {
    await click('.ticket[data-id=t1]')
    await click('.close')
    expect(posts()).toEqual([{ method: 'POST', url: '/api/tickets/t1/close' }])
  })

  it('refuses to close a ticket with an unsent reply', async () => {
    await click('.ticket[data-id=t1]')
    await type('.reply', 'Half a thought')
    await click('.close')
    expect(posts()).toEqual([])
    expect($('.notice').textContent).toMatch(/Send or discard/)
  })

  it('keeps an unsent reply when you switch folders and come back', async () => {
    await click('.ticket[data-id=t1]')
    await type('.reply', 'Half a thought')
    await click('.folder[data-folder=closed]')
    await click('.folder[data-folder=open]')
    await click('.ticket[data-id=t1]')
    expect($('.reply').value).toBe('Half a thought')
  })

  // What each change says it adds.
  it.runIf(variant === '1-open-count')('shows the number of open tickets on the Open tab', () => {
    expect($('.folder[data-folder=open]').textContent).toContain('2')
  })
  it.runIf(variant === '2-priority-badge')('shows a priority badge on each ticket', () => {
    expect($('.ticket[data-id=t1] .priority').textContent).toBe('high')
  })
  it.runIf(variant === '2-priority-badge')('selects the ticket when you click on the badge', async () => {
    await click('.ticket[data-id=t2] .priority')
    expect($('.detail h2').textContent).toBe('Cannot log in')
  })
  it.runIf(variant === '4-clear-search')('clears the search when you switch folders', async () => {
    await type('.search', 'refund')
    await click('.folder[data-folder=closed]')
    expect($('.search').value).toBe('')
  })
})
