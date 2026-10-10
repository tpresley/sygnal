import { describe, it, expect, afterEach, vi } from 'vitest'
import { mountApp, click, typeInto, setChecked, textOf, queryByText, getByText, waitFor, sleep } from './dom.js'
import { aiServer, fieldNamed, shown } from './aiserver.js'

// POST /api/chat is a fake AI SDK 7 route (aiserver.js) that declares three client tools
// (packing_add_item, item_set_packed, item_remove): the test plays the model, calling tools in a
// reply and checking what the app sends back.

afterEach(() => {
  document.removeEventListener('submit', recordSubmit, true)
  for (const e of submits) expect(e.defaultPrevented, 'a form submission was not prevented (page reload)').toBe(true)
  submits = []
  vi.unstubAllGlobals()
})

let submits = []
function recordSubmit(e) { submits.push(e) }

async function open() {
  const server = aiServer()
  document.addEventListener('submit', recordSubmit, true)
  await mountApp()
  return server
}

const items = () => [...document.querySelectorAll('.items .item')]
const itemNamed = (name) => items().find((li) => textOf(li).includes(name)) ?? null
const names = () => items().map((li) => textOf(li.querySelector('label') ?? li).trim())
const packedBox = (name) => itemNamed(name).querySelector('input[type="checkbox"]')
const summary = () => textOf(document.querySelector('.summary'))
const replies = () => [...document.querySelectorAll('ol.assistant-messages > li')].map(textOf)
const dialog = () => [...document.querySelectorAll('[role="alertdialog"]')].find(shown) ?? null

/** the body as text, with JSON inside strings unescaped (the list may travel as text) */
const bodyText = (req) => JSON.stringify(req.body).replace(/\\"/g, '"')
const mentionsId = (text, id) => new RegExp(`id"?'?\\s*[:=]?\\s*"?${id}\\b`).test(text)

const outputText = (part) => JSON.stringify(part?.output ?? part?.errorText ?? '')
const FAILURE = /error|invalid|not found|no such|doesn.t exist|does not exist|unknown|declin|denied|refused|rejected|cancel|must|cannot|can.t|not allowed|"ok":false/i
const succeeded = (part) => part?.state === 'output-available' && !FAILURE.test(outputText(part))
const failed = (part) => part?.state === 'output-error' || part?.state === 'output-denied' || (part?.state === 'output-available' && FAILURE.test(outputText(part)))
const declined = (part) => part?.state === 'output-denied' || /declin|denied|refused|rejected|cancel/i.test(outputText(part))

/** the Send button of the assistant's form (the list has its own "Add") */
function sendButton() {
  const form = fieldNamed('Ask the assistant').closest('form')
  return getByText('button', /^Send$/, form)
}

async function askIn(server, text) {
  await typeInto(fieldNamed('Ask the assistant'), text)
  await click(sendButton())
  return server.next('/api/chat')
}

describe('packing assistant', () => {
  it('asks with the current list and shows the reply', async () => {
    const server = await open()
    const req = await askIn(server, 'What is left to pack?')
    expect(fieldNamed('Ask the assistant').value).toBe('')
    expect(req.lastUserText()).toBe('What is left to pack?')
    expect(req.messages[req.messages.length - 1].role).toBe('user')
    const body = bodyText(req)
    for (const [id, name] of [[1, 'Tent'], [2, 'Socks'], [3, 'Headlamp']]) {
      expect(body, `the request names ${name}`).toContain(name)
      expect(mentionsId(body, id), `the request gives the id ${id}`).toBe(true)
    }
    await req.reply(['The tent and ', 'the headlamp.'])
    await waitFor(() => expect(replies()).toEqual(['What is left to pack?', 'The tent and the headlamp.']))
  })

  it('runs packing_add_item and sends the result back at once', async () => {
    const server = await open()
    const req = await askIn(server, 'Add two water bottles')
    const call = await req.toolCall('packing_add_item', { name: 'Water bottle', quantity: 2 })
    await req.finish('tool-calls')
    await waitFor(() => expect(itemNamed('Water bottle')).not.toBeNull())
    expect(textOf(itemNamed('Water bottle'))).toContain('×2')
    expect(packedBox('Water bottle').checked).toBe(false)
    expect(summary()).toBe('1 of 4 packed')
    const next = await server.next('/api/chat')
    expect(succeeded(next.toolPart(call)), `the result of the call: ${JSON.stringify(next.toolPart(call))}`).toBe(true)
    expect(bodyText(next), 'the follow-up tells the model the list as it is now').toContain('Water bottle')
    expect(next.userTexts().filter((t) => t === 'Add two water bottles').length, 'the question is sent once').toBe(1)
    await next.reply(['Added two water bottles.'])
    await waitFor(() => expect(replies()).toContain('Added two water bottles.'))
    expect(await server.noneWithin('/api/chat', 200)).toBe(true)
  })

  it('runs several calls of one reply, then sends one follow-up with every result', async () => {
    const server = await open()
    const req = await askIn(server, 'I packed the tent and the headlamp')
    const a = await req.toolCall('item_set_packed', { id: 1, packed: true })
    const b = await req.toolCall('item_set_packed', { id: 3, packed: true })
    const c = await req.toolCall('item_set_packed', { id: 2, packed: false })
    await req.finish('tool-calls')
    await waitFor(() => expect(packedBox('Tent').checked).toBe(true))
    await waitFor(() => expect(packedBox('Headlamp').checked).toBe(true))
    expect(packedBox('Socks').checked).toBe(false)
    expect(summary()).toBe('2 of 3 packed')
    const next = await server.next('/api/chat')
    for (const id of [a, b, c]) expect(succeeded(next.toolPart(id)), `the result of ${id}`).toBe(true)
    await next.reply(['Done.'])
    await waitFor(() => expect(replies()).toContain('Done.'))
    expect(await server.noneWithin('/api/chat', 200), 'one follow-up request for the whole reply').toBe(true)
  })

  it('a call that cannot be done changes nothing and reports an error', async () => {
    const server = await open()
    const req = await askIn(server, 'Do some things')
    const blank = await req.toolCall('packing_add_item', { name: '   ', quantity: 0 })
    const tooMany = await req.toolCall('packing_add_item', { name: 'Rope', quantity: 150 })
    const missing = await req.toolCall('item_set_packed', { id: 42, packed: true })
    const gone = await req.toolCall('item_remove', { id: 42 })
    await req.finish('tool-calls')
    const next = await server.next('/api/chat')
    expect(dialog(), 'no consent is asked for an item that does not exist').toBeNull()
    for (const id of [blank, tooMany, missing, gone]) expect(failed(next.toolPart(id)), `the result of ${id}: ${JSON.stringify(next.toolPart(id))}`).toBe(true)
    expect(names()).toEqual(['Tent', 'Socks', 'Headlamp'])
    expect(summary()).toBe('1 of 3 packed')
    await next.reply(['Sorry, I could not do that.'])
    await waitFor(() => expect(replies()).toContain('Sorry, I could not do that.'))
  })

  it('item_remove waits for consent; Deny keeps the item and tells the model', async () => {
    const server = await open()
    const req = await askIn(server, 'Remove the headlamp')
    const call = await req.toolCall('item_remove', { id: 3 })
    await req.finish('tool-calls')
    await waitFor(() => expect(dialog()).not.toBeNull())
    expect(textOf(dialog())).toContain('Headlamp')
    expect(itemNamed('Headlamp'), 'nothing is removed before the user answers').not.toBeNull()
    expect(await server.noneWithin('/api/chat', 300), 'nothing is sent before the user answers').toBe(true)
    await click(getByText('button', /^Deny$/, dialog()))
    await waitFor(() => expect(dialog()).toBeNull())
    const next = await server.next('/api/chat')
    expect(declined(next.toolPart(call)), `the result says the user declined: ${JSON.stringify(next.toolPart(call))}`).toBe(true)
    expect(names()).toEqual(['Tent', 'Socks', 'Headlamp'])
    await next.reply(['OK, I kept it.'])
    await waitFor(() => expect(replies()).toContain('OK, I kept it.'))
  })

  it('item_remove with Allow removes the item', async () => {
    const server = await open()
    const req = await askIn(server, 'Take the socks off the list')
    const call = await req.toolCall('item_remove', { id: 2 })
    await req.finish('tool-calls')
    await waitFor(() => expect(dialog()).not.toBeNull())
    expect(textOf(dialog())).toContain('Socks')
    await click(getByText('button', /^Allow$/, dialog()))
    await waitFor(() => expect(itemNamed('Socks')).toBeNull())
    expect(dialog()).toBeNull()
    expect(summary()).toBe('0 of 2 packed')
    const next = await server.next('/api/chat')
    expect(succeeded(next.toolPart(call)), `the result of the call: ${JSON.stringify(next.toolPart(call))}`).toBe(true)
    await next.reply(['Removed the socks.'])
    await waitFor(() => expect(replies()).toContain('Removed the socks.'))
  })

  it('the list still works by hand, and the assistant sees the changes', async () => {
    const server = await open()
    await setChecked(packedBox('Tent'), true)
    expect(summary()).toBe('2 of 3 packed')
    await click(getByText('button', /^Remove$/, itemNamed('Headlamp')))
    expect(names()).toEqual(['Tent', 'Socks'])
    await typeInto(fieldNamed('Item'), 'Map')
    await click(getByText('button', /^Add$/))
    expect(names()).toEqual(['Tent', 'Socks', 'Map'])
    const req = await askIn(server, 'What is on the list?')
    const body = bodyText(req)
    expect(body).toContain('Map')
    expect(body).not.toContain('Headlamp')
    await req.reply(['Tent, socks and a map.'])
    await waitFor(() => expect(replies()).toContain('Tent, socks and a map.'))
  })
})
