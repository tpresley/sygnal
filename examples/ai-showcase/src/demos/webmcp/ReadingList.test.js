// @vitest-environment jsdom
import { it, expect, afterEach, vi } from 'vitest'
import { renderComponent, run, xs } from 'sygnal'
import { experimentalExposeWebMcp } from 'sygnal/ai'
import ReadingList from './ReadingList.jsx'
import { start } from './index.js'

let t, app, mount
afterEach(() => {
  t?.dispose()
  app?.dispose()
  mount?.remove()
  t = app = mount = null
})

const mountPoint = () => {
  mount = document.createElement('div')
  document.body.append(mount)
  return mount
}
const names = (tools) => [...tools].map((tool) => tool.name ?? tool)
// the console's drivers are index.js's; here stand-ins
const stubs = { WEBMCP: () => ({ select: () => xs.never() }) }

it('declares the reading list, the books and the goal as agent tools', async () => {
  t = renderComponent(ReadingList, { drivers: stubs })
  await t.ready()
  expect(names(t.tools())).toEqual(['books_read', 'books_clear_finished', 'book_move', 'book_remove', 'goal_read', 'goal_set_goal'])
  expect(t.tools().find((tool) => tool.name === 'book_remove').annotations).toMatchObject({ consequentialHint: true })

  expect(await t.callTool('book_move', { id: 2, shelf: 'finished' })).toMatchObject({ ok: true })
  expect(t.agentContext().goal).toEqual({ goal: 12, finished: 2 })
  // CLEAR_FINISHED is offered only while a book is finished (`when`)
  expect(await t.callTool('books_clear_finished', {}, { confirm: true })).toMatchObject({ ok: true })
  expect(names(t.tools())).not.toContain('books_clear_finished')
})

it('registers the tools with WebMCP, and again as the app changes', async () => {
  const tools = new Map()
  const modelContext = {
    registerTool: async (tool, { signal }) => {
      tools.set(tool.name, tool)
      signal.addEventListener('abort', () => tools.get(tool.name) === tool && tools.delete(tool.name))
    },
  }
  app = run(ReadingList, stubs, { mountPoint: mountPoint() })
  await app.__runtime.flushed()
  const stop = experimentalExposeWebMcp(app, { modelContext, confirm: true })

  expect(names(tools.keys())).toContain('books_clear_finished')
  expect(tools.get('books_read').annotations).toMatchObject({ readOnlyHint: true, untrustedContentHint: true })
  // the goal's numbers are the app's own: a summary of them ends its tools' descriptions
  expect(tools.get('goal_set_goal').description).toContain('Current state: {"goal":12,"finished":1}')

  expect(await tools.get('books_clear_finished').execute({})).toMatchObject({ ok: true })
  await app.__runtime.flushed()
  expect(names(tools.keys())).not.toContain('books_clear_finished')
  expect(tools.get('book_move').inputSchema.properties.id.enum).toEqual([1, 2, 4])
  stop()
  expect(tools.size).toBe(0)
})

it('the console lists the form tool, fills the form as an agent, and answers once you submit', async () => {
  app = start(mountPoint(), 'webmcp')
  const el = mount
  await vi.waitFor(() => expect(el.querySelector('.tool-item[data-tool="add_book"]')).not.toBeNull())
  expect(el.querySelector('.agent-console').textContent).toContain('Native WebMCP: not in this browser')
  expect(el.querySelector('form.add-book').getAttribute('toolname')).toBe('add_book')

  el.querySelector('.tool-item[data-tool="add_book"]').click()
  await vi.waitFor(() => expect(JSON.parse(el.querySelector('.args').value)).toMatchObject({ title: 'The Hobbit', shelf: 'want' }))
  el.querySelector('.call-form').requestSubmit()
  await vi.waitFor(() => expect(el.querySelector('[name="title"]').value).toBe('The Hobbit'))
  expect(el.querySelector('.call-panel').textContent).toContain('press Add book')

  el.querySelector('form.add-book').requestSubmit()   // the user reviews and submits
  await vi.waitFor(() => expect(el.querySelector('.result').textContent).toContain('"ok": true'))
  expect([...el.querySelectorAll('.book .title')].map((b) => b.textContent)).toContain('The Hobbit')
})

it('asks before a consequential call, with Sygnal\'s dialog', async () => {
  app = start(mountPoint(), 'webmcp')
  const el = mount
  await vi.waitFor(() => expect(el.querySelector('.tool-item[data-tool="book_remove"]')).not.toBeNull())
  el.querySelector('.tool-item[data-tool="book_remove"]').click()
  await vi.waitFor(() => expect(el.querySelector('.args')).not.toBeNull())
  el.querySelector('.call-form').requestSubmit()   // the example arguments: { id: 1 }

  const dialog = await vi.waitFor(() => document.querySelector('dialog[data-sygnal-webmcp]') ?? Promise.reject(new Error('no dialog yet')))
  expect(dialog.textContent).toContain('Remove the book from the reading list (The Left Hand of Darkness)')
  ;[...dialog.querySelectorAll('button')].find((b) => b.textContent === 'Deny').click()
  await vi.waitFor(() => expect(el.querySelector('.result').textContent).toContain('the user declined'))
  expect(el.querySelectorAll('.book')).toHaveLength(4)
})
