import { describe, it, expect, vi, afterEach } from 'vitest'
import { mountApp, waitFor, textOf, click, typeInto, setChecked, sleep, getByText } from './dom.js'

const LOOKING_UP = /Looking up(…|\.\.\.)/
const PLACES = {
  62704: { city: 'Springfield', express: true },
  10001: { city: 'New York', express: true },
  59001: { city: 'Absarokee', express: false },
}

function jsonResponse(body, status = 200) {
  if (typeof Response === 'function') {
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
  }
  return { ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) }
}

const urlOf = (arg) => String(arg && typeof arg === 'object' && 'url' in arg ? arg.url : arg)
const pathOf = (arg) => new URL(urlOf(arg), 'http://localhost').pathname

/** A fake ZIP service: every fetch stays pending until the test answers it, by ZIP. */
function zipServer() {
  const pending = []
  const fn = vi.fn((input) => new Promise((resolve, reject) => pending.push({ zip: pathOf(input).split('/').pop(), resolve, reject })))
  const take = (zip) => {
    const i = pending.findIndex((p) => p.zip === zip)
    if (i < 0) throw new Error(`no pending lookup for ${zip}; pending: ${pending.map((p) => p.zip).join(', ')}`)
    return pending.splice(i, 1)[0]
  }
  return {
    fn,
    paths: () => fn.mock.calls.map((call) => pathOf(call[0])),
    respond: (zip) => take(zip).resolve(jsonResponse(PLACES[zip])),
    notFound: (zip) => take(zip).resolve(jsonResponse({ error: 'not found' }, 404)),
    serverError: (zip) => take(zip).resolve(jsonResponse({ error: 'boom' }, 500)),
    fail: (zip) => take(zip).reject(new TypeError('Failed to fetch')),
  }
}

async function start() {
  const server = zipServer()
  vi.stubGlobal('fetch', server.fn)
  await mountApp()
  return server
}

afterEach(() => {
  vi.unstubAllGlobals()
})

const zip = () => document.querySelector('input[name="zip"]')
const city = () => document.querySelector('input[name="city"]')
const express = () => document.querySelector('input[name="express"]')
const status = () => textOf(document.querySelector('.zip-status'))
const saved = () => textOf(document.querySelector('.saved'))

async function save() {
  await click(getByText('button', 'Save address'))
}

describe('17 ZIP lookup: latest response only, real form state and focus', () => {
  it('looks up only complete 5-digit ZIPs, and shows "Looking up…" meanwhile', async () => {
    const server = await start()
    await typeInto(zip(), '6270')
    await typeInto(zip(), '627a4')
    await sleep(100)
    expect(server.fn).not.toHaveBeenCalled()
    expect(status()).toBe('')

    await typeInto(zip(), '62704')
    await waitFor(() => expect(server.paths()).toEqual(['/api/zip/62704']))
    await waitFor(() => expect(status()).toMatch(LOOKING_UP))
    await sleep(100)
    expect(server.fn).toHaveBeenCalledTimes(1)
  })

  it('a successful lookup fills the City field, clears the status and leaves focus alone', async () => {
    const server = await start()
    await typeInto(city(), 'Somewhere')
    await typeInto(zip(), '62704')
    await waitFor(() => expect(server.fn).toHaveBeenCalledTimes(1))
    expect(document.activeElement).toBe(zip())
    server.respond('62704')
    await waitFor(() => expect(city().value).toBe('Springfield'))
    await waitFor(() => expect(status()).toBe(''))
    expect(document.activeElement).toBe(zip())
    expect(express().disabled).toBe(false)

    await save()
    await waitFor(() => expect(saved()).toBe('Saved: Springfield, 62704 (standard)'))
  })

  it('a ZIP without express delivery unchecks and disables the checkbox, even if the user checked it', async () => {
    const server = await start()
    await setChecked(express(), true)
    expect(express().checked).toBe(true)
    await typeInto(zip(), '59001')
    await waitFor(() => expect(server.fn).toHaveBeenCalledTimes(1))
    server.respond('59001')
    await waitFor(() => expect(city().value).toBe('Absarokee'))
    await waitFor(() => expect(express().disabled).toBe(true))
    expect(express().checked).toBe(false)
    await save()
    await waitFor(() => expect(saved()).toBe('Saved: Absarokee, 59001 (standard)'))

    // A ZIP with express delivery enables it again, and the user can check it.
    await typeInto(zip(), '10001')
    await waitFor(() => expect(server.fn).toHaveBeenCalledTimes(2))
    server.respond('10001')
    await waitFor(() => expect(city().value).toBe('New York'))
    await waitFor(() => expect(express().disabled).toBe(false))
    expect(express().checked).toBe(false)
    await save()
    await waitFor(() => expect(saved()).toBe('Saved: New York, 10001 (standard)'))
    await setChecked(express(), true)
    await save()
    await waitFor(() => expect(saved()).toBe('Saved: New York, 10001 (express)'))
  })

  it('an unknown ZIP shows a message and moves focus to the City field, keeping its text', async () => {
    const server = await start()
    await typeInto(city(), 'Shelbyville')
    await typeInto(zip(), '00000')
    await waitFor(() => expect(server.fn).toHaveBeenCalledTimes(1))
    server.notFound('00000')
    await waitFor(() => expect(status()).toBe('Unknown ZIP code.'))
    await waitFor(() => expect(document.activeElement).toBe(city()))
    expect(city().value).toBe('Shelbyville')

    await typeInto(city(), 'Shelbyville Heights')
    await save()
    await waitFor(() => expect(saved()).toBe('Saved: Shelbyville Heights, 00000 (standard)'))
  })

  it('other failures show "Lookup failed." and also move focus to the City field', async () => {
    const server = await start()
    await typeInto(zip(), '62704')
    await waitFor(() => expect(server.fn).toHaveBeenCalledTimes(1))
    server.serverError('62704')
    await waitFor(() => expect(status()).toBe('Lookup failed.'))
    await waitFor(() => expect(document.activeElement).toBe(city()))

    await typeInto(zip(), '10001')
    await waitFor(() => expect(server.fn).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(status()).toMatch(LOOKING_UP))
    server.fail('10001')
    await waitFor(() => expect(status()).toBe('Lookup failed.'))
    expect(city().value).toBe('')
  })

  it('a stale success never overwrites the newer lookup, in either order', async () => {
    const server = await start()
    await typeInto(zip(), '62704')
    await waitFor(() => expect(server.fn).toHaveBeenCalledTimes(1))
    await typeInto(zip(), '10001')
    await waitFor(() => expect(server.fn).toHaveBeenCalledTimes(2))

    // The older one arrives first: ignored, still looking up.
    server.respond('62704')
    await sleep(150)
    expect(city().value).toBe('')
    expect(status()).toMatch(LOOKING_UP)

    server.respond('10001')
    await waitFor(() => expect(city().value).toBe('New York'))
    expect(status()).toBe('')

    // And the other way round: newer first, then the older one.
    await typeInto(zip(), '59001')
    await waitFor(() => expect(server.fn).toHaveBeenCalledTimes(3))
    await typeInto(zip(), '62704')
    await waitFor(() => expect(server.fn).toHaveBeenCalledTimes(4))
    server.respond('62704')
    await waitFor(() => expect(city().value).toBe('Springfield'))
    server.respond('59001')
    await sleep(150)
    expect(city().value).toBe('Springfield')
    expect(express().disabled).toBe(false)
  })

  it('a stale failure shows nothing and does not move focus', async () => {
    const server = await start()
    await typeInto(zip(), '00000')
    await waitFor(() => expect(server.fn).toHaveBeenCalledTimes(1))
    await typeInto(zip(), '62704')
    await waitFor(() => expect(server.fn).toHaveBeenCalledTimes(2))
    server.notFound('00000')
    await sleep(150)
    expect(document.activeElement).toBe(zip())
    expect(status()).not.toContain('Unknown ZIP code.')
    server.respond('62704')
    await waitFor(() => expect(city().value).toBe('Springfield'))
    expect(document.activeElement).toBe(zip())
    expect(status()).toBe('')
  })

  it('editing the ZIP to fewer digits cancels the lookup in flight and re-enables the checkbox', async () => {
    const server = await start()
    await typeInto(zip(), '59001')
    await waitFor(() => expect(server.fn).toHaveBeenCalledTimes(1))
    server.respond('59001')
    await waitFor(() => expect(express().disabled).toBe(true))

    await typeInto(zip(), '62704')
    await waitFor(() => expect(server.fn).toHaveBeenCalledTimes(2))
    await typeInto(zip(), '6270')
    await waitFor(() => expect(status()).toBe(''))
    expect(express().disabled).toBe(false)
    server.notFound('62704')
    await sleep(150)
    expect(status()).toBe('')
    expect(document.activeElement).toBe(zip())
    expect(city().value).toBe('Absarokee')
    expect(server.fn).toHaveBeenCalledTimes(2)

    // Hand edits after a lookup are kept and saved.
    await typeInto(city(), 'Absarokee East')
    await setChecked(express(), true)
    await save()
    await waitFor(() => expect(saved()).toBe('Saved: Absarokee East, 6270 (express)'))
  })
})
