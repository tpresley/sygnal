import { describe, it, expect, afterEach, vi } from 'vitest'
import { mountApp, click, typeInto, textOf, queryByText, getByText, waitFor, sleep } from './dom.js'
import { aiServer, fieldNamed, shown, messageText } from './aiserver.js'

// POST /api/chat is a fake AI SDK 7 route (aiserver.js): each request stays open until the test
// streams its reply chunk by chunk, so the test sees the page while the reply arrives.

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

const field = () => fieldNamed('Message')
const sendButton = () => getByText('button', /^Send$/)
const stopButton = () => { const b = queryByText('button', /^Stop$/); return shown(b) ? b : null }
const alertEl = () => [...document.querySelectorAll('[role="alert"]')].find((el) => shown(el) && /Something went wrong\./.test(textOf(el))) ?? null
const items = () => [...document.querySelectorAll('ol.messages > li')]
const conversation = () => items().map((li) => [li.classList.contains('user') ? 'user' : li.classList.contains('assistant') ? 'assistant' : '?', textOf(li)])
const lastAssistant = () => { const a = items().filter((li) => li.classList.contains('assistant')); return a.length ? textOf(a[a.length - 1]) : null }

async function send(server, text) {
  await typeInto(field(), text)
  await click(sendButton())
  return server.next('/api/chat')
}

describe('streaming chat', () => {
  it('sends the message and streams the reply into the conversation', async () => {
    const server = await open()
    expect(stopButton(), 'no Stop button before anything is sent').toBeNull()
    const req = await send(server, 'Where is my order?')
    expect(req.method).toBe('POST')
    expect(req.userTexts()).toEqual(['Where is my order?'])
    expect(req.messages[req.messages.length - 1].role).toBe('user')
    expect(field().value, 'the field is cleared').toBe('')
    expect(conversation()[0]).toEqual(['user', 'Where is my order?'])
    expect(sendButton().disabled, 'Send is disabled while the reply is on its way').toBe(true)
    expect(stopButton(), 'Stop is shown while the reply is on its way').not.toBeNull()

    await req.text(['Your order ', 'shipped '])
    await waitFor(() => expect(lastAssistant()).toBe('Your order shipped'))
    expect(sendButton().disabled, 'Send stays disabled while streaming').toBe(true)
    await req.text(['yesterday.'])
    await waitFor(() => expect(lastAssistant()).toBe('Your order shipped yesterday.'))
    await req.finish()
    await waitFor(() => expect(sendButton().disabled).toBe(false))
    expect(stopButton(), 'no Stop button once the reply is complete').toBeNull()
    expect(conversation()).toEqual([['user', 'Where is my order?'], ['assistant', 'Your order shipped yesterday.']])
  })

  it('sends the whole conversation on the next message', async () => {
    const server = await open()
    const first = await send(server, 'Hi')
    await first.reply(['Hello! ', 'How can I help?'])
    await waitFor(() => expect(sendButton().disabled).toBe(false))
    const second = await send(server, 'I need a refund')
    expect(second.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user'])
    expect(second.messages.map(messageText)).toEqual(['Hi', 'Hello! How can I help?', 'I need a refund'])
    for (const m of second.messages) expect(Array.isArray(m.parts), 'messages are UI messages with parts').toBe(true)
    await second.reply(['Sure.'])
    await waitFor(() => expect(conversation().map((c) => c[1])).toEqual(['Hi', 'Hello! How can I help?', 'I need a refund', 'Sure.']))
  })

  it('sends nothing for a blank message', async () => {
    const server = await open()
    await typeInto(field(), '   ')
    await click(sendButton())
    expect(await server.noneWithin('/api/chat', 250)).toBe(true)
    expect(items().length).toBe(0)
  })

  it('Stop cancels the request and keeps the text received so far', async () => {
    const server = await open()
    const req = await send(server, 'Tell me a long story')
    await req.text(['Once upon ', 'a time'])
    await waitFor(() => expect(lastAssistant()).toBe('Once upon a time'))
    await click(stopButton())
    await waitFor(() => expect(req.aborted, 'the request is aborted').toBe(true))
    await req.text([' there was more'])
    await sleep(100)
    expect(lastAssistant()).toBe('Once upon a time')
    expect(stopButton()).toBeNull()
    expect(sendButton().disabled).toBe(false)
    expect(alertEl(), 'stopping is not an error').toBeNull()
    // the conversation goes on
    const next = await send(server, 'Shorter please')
    expect(next.lastUserText()).toBe('Shorter please')
    await next.reply(['The end.'])
    await waitFor(() => expect(lastAssistant()).toBe('The end.'))
  })

  it('Stop before any text arrives', async () => {
    const server = await open()
    const req = await send(server, 'Hello?')
    await click(stopButton())
    await waitFor(() => expect(req.aborted).toBe(true))
    await waitFor(() => expect(sendButton().disabled).toBe(false))
    expect(stopButton()).toBeNull()
    expect(alertEl()).toBeNull()
    expect(conversation()[0]).toEqual(['user', 'Hello?'])
  })

  it('an HTTP error shows the alert; Retry sends the conversation again', async () => {
    const server = await open()
    const req = await send(server, 'Cancel my plan')
    await req.fail(500)
    await waitFor(() => expect(alertEl()).not.toBeNull())
    expect(sendButton().disabled, 'Send works again after a failure').toBe(false)
    expect(stopButton()).toBeNull()
    await click(getByText('button', /^Retry$/))
    const retry = await server.next('/api/chat')
    expect(retry.userTexts()).toEqual(['Cancel my plan'])
    expect(retry.messages.filter((m) => m.role === 'assistant').length).toBe(0)
    expect(alertEl(), 'Retry removes the alert').toBeNull()
    await retry.reply(['Done: your plan is cancelled.'])
    await waitFor(() => expect(conversation()).toEqual([['user', 'Cancel my plan'], ['assistant', 'Done: your plan is cancelled.']]))
  })

  it('an error in the stream drops the partial reply; Retry sends the conversation again', async () => {
    const server = await open()
    const first = await send(server, 'Hi')
    await first.reply(['Hello!'])
    await waitFor(() => expect(sendButton().disabled).toBe(false))
    const req = await send(server, 'What is your refund policy?')
    await req.text(['You can '])
    await req.streamError('The model is overloaded.')
    await waitFor(() => expect(alertEl()).not.toBeNull())
    await click(getByText('button', /^Retry$/))
    const retry = await server.next('/api/chat')
    expect(retry.messages.map(messageText)).toEqual(['Hi', 'Hello!', 'What is your refund policy?'])
    await retry.reply(['Within 30 days.'])
    await waitFor(() => expect(conversation().map((c) => c[1])).toEqual(['Hi', 'Hello!', 'What is your refund policy?', 'Within 30 days.']))
    expect(alertEl()).toBeNull()
  })

  it('a network error shows the alert; a new message removes it', async () => {
    const server = await open()
    const req = await send(server, 'Hello')
    await req.networkError()
    await waitFor(() => expect(alertEl()).not.toBeNull())
    const next = await send(server, 'Are you there?')
    expect(alertEl()).toBeNull()
    expect(next.lastUserText()).toBe('Are you there?')
    await next.reply(['Yes!'])
    await waitFor(() => expect(lastAssistant()).toBe('Yes!'))
  })
})
