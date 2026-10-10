import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { mountApp, click, typeInto, choose, textOf, getByText, waitFor, sleep } from './dom.js'
import { fakeModelContext, installDialogPolyfill, fieldNamed } from './aiserver.js'

// A fake WebMCP `document.modelContext` (aiserver.js) is installed before the app starts; the
// test calls the registered tools like a browser agent. jsdom has no showModal()/close(): they
// are installed as a browser behaves (installDialogPolyfill).

let mc
beforeEach(() => {
  installDialogPolyfill()
  mc = fakeModelContext()
  Object.defineProperty(document, 'modelContext', { value: mc, configurable: true, writable: true })
  Object.defineProperty(navigator, 'modelContext', { value: mc, configurable: true, writable: true })
})
afterEach(() => {
  delete document.modelContext
  delete navigator.modelContext
  vi.unstubAllGlobals()
})

const TOOLS = ['board_read', 'board_add_card', 'card_move', 'card_remove']

async function open() {
  await mountApp()
  await waitFor(() => { for (const t of TOOLS) if (!mc.tool(t)) throw new Error(`no tool ${t}; registered: ${mc.names().join(', ') || 'none'}`) })
}

const cards = () => [...document.querySelectorAll('.column .card')]
const cardNamed = (title) => cards().find((c) => textOf(c.querySelector('.title') ?? c) === title) ?? null
const columnOf = (title) => { const c = cardNamed(title); return c ? textOf(c.closest('.column').querySelector('h2')) : null }
const titles = () => cards().map((c) => textOf(c.querySelector('.title') ?? c)).sort()
const SEED = ['Design review', 'Fix login bug', 'Old idea', 'Plan the sprint', 'Ship v2']
const dialog = () => document.querySelector('dialog[open]')

const ok = (r) => r && typeof r === 'object' && r.ok === true
const notOk = (r) => r && typeof r === 'object' && r.ok === false && typeof r.error === 'string' && r.error.length > 0
const props = (name) => mc.tool(name).inputSchema?.properties ?? {}
const required = (name) => mc.tool(name).inputSchema?.required ?? []
const enumOf = (schema) => schema?.enum ?? schema?.anyOf?.flatMap((s) => s.enum ?? (s.const !== undefined ? [s.const] : [])) ?? []

describe('board tools (WebMCP)', () => {
  it('registers the four tools with descriptions and input schemas', async () => {
    await open()
    for (const t of TOOLS) {
      const tool = mc.tool(t)
      expect(typeof tool.description === 'string' && tool.description.trim().length > 0, `${t} has a description`).toBe(true)
      expect(tool.inputSchema?.type, `${t}'s input schema is an object`).toBe('object')
      expect(typeof tool.execute).toBe('function')
    }
    expect(Object.keys(props('board_add_card'))).toEqual(expect.arrayContaining(['title', 'column']))
    expect(props('board_add_card').title.type).toBe('string')
    expect(enumOf(props('board_add_card').column).sort()).toEqual(['doing', 'done', 'todo'])
    expect(required('board_add_card')).toEqual(expect.arrayContaining(['title', 'column']))
    expect(Object.keys(props('card_move'))).toEqual(expect.arrayContaining(['id', 'column']))
    expect(enumOf(props('card_move').column).sort()).toEqual(['doing', 'done', 'todo'])
    expect(required('card_move')).toEqual(expect.arrayContaining(['id', 'column']))
    expect(Object.keys(props('card_remove'))).toContain('id')
    expect(required('card_remove')).toContain('id')
  })

  it('board_read returns every card with its id, title and column', async () => {
    await open()
    const r = await mc.call('board_read', {})
    const text = JSON.stringify(r)
    for (const t of SEED) expect(text).toContain(t)
    expect(text).toMatch(/"id":\s*1\b/)
    expect(text).toMatch(/"column":\s*"todo"/)
    expect(text).toMatch(/"column":\s*"doing"/)
    expect(text).toMatch(/"column":\s*"done"/)
    expect(titles()).toEqual(SEED)
  })

  it('board_add_card adds a card; bad input changes nothing', async () => {
    await open()
    const r = await mc.call('board_add_card', { title: 'Update the docs', column: 'doing' })
    expect(ok(r), JSON.stringify(r)).toBe(true)
    await waitFor(() => expect(columnOf('Update the docs')).toBe('Doing'))
    expect(textOf(document.querySelector('.card-count'))).toBe('6 cards')
    for (const bad of [{ title: '   ', column: 'doing' }, { title: 'Later', column: 'later' }, { title: 'No column' }, { column: 'todo' }]) {
      const res = await mc.call('board_add_card', bad)
      expect(notOk(res), `${JSON.stringify(bad)} -> ${JSON.stringify(res)}`).toBe(true)
    }
    expect(titles()).toEqual([...SEED, 'Update the docs'].sort())
    const read = JSON.stringify(await mc.call('board_read', {}))
    expect(read).toContain('Update the docs')
  })

  it('card_move moves a card; an unknown id or column changes nothing', async () => {
    await open()
    const r = await mc.call('card_move', { id: 1, column: 'done' })
    expect(ok(r), JSON.stringify(r)).toBe(true)
    await waitFor(() => expect(columnOf('Fix login bug')).toBe('Done'))
    expect(notOk(await mc.call('card_move', { id: 99, column: 'done' }))).toBe(true)
    expect(notOk(await mc.call('card_move', { id: 2, column: 'archive' }))).toBe(true)
    expect(notOk(await mc.call('card_move', { column: 'done' }))).toBe(true)
    expect([columnOf('Plan the sprint'), columnOf('Old idea'), columnOf('Ship v2')]).toEqual(['Doing', 'To do', 'Done'])
    expect(titles()).toEqual(SEED)
  })

  it('tools work on cards added later, by an agent or by hand', async () => {
    await open()
    expect(ok(await mc.call('board_add_card', { title: 'Write tests', column: 'todo' }))).toBe(true)
    const read = await mc.call('board_read', {})
    const id = JSON.parse(JSON.stringify(read).match(/\{[^{}]*"title":"Write tests"[^{}]*\}/)[0]).id
    expect(ok(await mc.call('card_move', { id, column: 'doing' }))).toBe(true)
    await waitFor(() => expect(columnOf('Write tests')).toBe('Doing'))

    await typeInto(fieldNamed('Title'), 'Book the venue')
    await click(getByText('button', /^Add card$/))
    await waitFor(() => expect(columnOf('Book the venue')).toBe('To do'))
    await choose(document.querySelector('[aria-label="Move Old idea"]') ?? cardNamed('Old idea').querySelector('select'), 'done')
    await waitFor(() => expect(columnOf('Old idea')).toBe('Done'))
    const after = JSON.stringify(await mc.call('board_read', {}))
    expect(after).toContain('Book the venue')
    const old = JSON.parse(after.match(/\{[^{}]*"title":"Old idea"[^{}]*\}/)[0])
    expect(old.column).toBe('done')
    const venue = JSON.parse(after.match(/\{[^{}]*"title":"Book the venue"[^{}]*\}/)[0])
    expect(ok(await mc.call('card_move', { id: venue.id, column: 'done' }))).toBe(true)
    await waitFor(() => expect(columnOf('Book the venue')).toBe('Done'))
  })

  it('card_remove asks first; Deny keeps the card', async () => {
    await open()
    const pending = mc.tool('card_remove').execute({ id: 3 })
    await waitFor(() => expect(dialog()).not.toBeNull())
    expect(textOf(dialog())).toContain('Old idea')
    expect(cardNamed('Old idea'), 'nothing is removed before the user answers').not.toBeNull()
    await click(getByText('button', /^Deny$/, dialog()))
    const r = await pending
    expect(notOk(r), JSON.stringify(r)).toBe(true)
    await sleep(60)
    expect(dialog()).toBeNull()
    expect(titles()).toEqual(SEED)
  })

  it('card_remove with Allow removes the card; an unknown id asks nothing', async () => {
    await open()
    const pending = mc.tool('card_remove').execute({ id: 5 })
    await waitFor(() => expect(dialog()).not.toBeNull())
    expect(textOf(dialog())).toContain('Design review')
    await click(getByText('button', /^Allow$/, dialog()))
    const r = await pending
    expect(ok(r), JSON.stringify(r)).toBe(true)
    await waitFor(() => expect(cardNamed('Design review')).toBeNull())
    expect(dialog()).toBeNull()
    expect(textOf(document.querySelector('.card-count'))).toBe('4 cards')

    const missing = mc.tool('card_remove').execute({ id: 42 })
    const res = await Promise.race([missing, sleep(500).then(() => 'still waiting')])
    expect(notOk(res), `an unknown card fails at once: ${JSON.stringify(res)}`).toBe(true)
    expect(dialog()).toBeNull()
  })
})
