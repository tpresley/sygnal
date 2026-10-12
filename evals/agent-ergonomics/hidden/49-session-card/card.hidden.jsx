import { describe, it, expect, afterEach } from 'vitest'
import { renderComponent } from 'sygnal'
import { composeWith } from 'sygnal/ai'
import { textOf } from './queries.js'
import App from '../src/App.jsx'

// PLAN-9 p9 tier. No model: the app runs with renderComponent on the real DOM (jsdom); the test
// plays the model with t.stream on the LLM sink (text, and the `ask_user` client tool call the
// prompt fixes), and reads what the app sends back with t.requests. If the app builds the card
// from a catalog whose composition is pending (a card on the tool part), composeWith answers that
// step with the backend's own fake reply, picking the catalog's result part. The catalog is found
// among the modules of src/ (any exported catalog); an app that answers ask_user itself (its own
// client tool and buttons) needs no composition and passes the same tests.

const modules = import.meta.glob(['../src/**/*.{js,jsx,ts,tsx}', '!../src/**/main.*', '!../src/**/*.test.*', '!../src/**/*.spec.*'], { eager: true })
const isCatalog = (v) => !!v && typeof v === 'object' && typeof v.render === 'function' && !!v.parts && typeof v.parts === 'object'
const catalogs = [...new Set(Object.values(modules).flatMap((m) => Object.values(m)).filter(isCatalog))]

const SESSIONS = {
  s1: 'Streams from scratch',
  s2: 'Testing without a browser',
  s3: 'Reactive forms in practice',
  s4: 'Shipping AI features safely',
}

let t
afterEach(() => { t?.dispose(); t = null })

async function open() {
  t = renderComponent(App, { dom: 'real' })
  await t.ready()
  await t.settle()
}

async function until(f, what, tries = 60) {
  for (let i = 0; i < tries && !f(); i++) await t.settle()
  if (!f()) throw new Error(`timed out waiting for ${what}`)
}

const toolNames = (r) => (Array.isArray(r?.tools) ? r.tools.map((x) => x.name) : Object.keys(r?.tools ?? {}))
/** the chat's requests (the ones that carry the conversation's tools; a card's own composition request doesn't) */
const chatReqs = () => t.requests('LLM').filter((r) => !String(r.key ?? '').includes('.ask:') && Array.isArray(r.messages))
const lastUserText = (r) => {
  const m = [...r.messages].reverse().find((x) => x.role === 'user' && x.metadata?.sygnal == null)
  return typeof m?.content === 'string' ? m.content : (m?.parts ?? []).filter((p) => p.type === 'text').map((p) => p.text).join('')
}
const askPart = (r, id) => r.messages.flatMap((m) => m.parts ?? []).find((p) => p.type === 'tool-ask_user' && p.toolCallId === id)
const mentions = (v, wanted) => v === wanted || (v && typeof v === 'object' && Object.values(v).some((x) => mentions(x, wanted)))
const mySession = () => textOf(t.container.querySelector('.my-session'))
const conversation = () => textOf(t.container.querySelector('.messages') ?? t.container)

/** the buttons whose text is a session's title */
const sessionButtons = () => [...t.container.querySelectorAll('button')].filter((b) => Object.values(SESSIONS).includes(textOf(b).trim()) || Object.values(SESSIONS).some((s) => textOf(b).includes(s)))
const buttonFor = (title) => {
  const all = sessionButtons().filter((b) => textOf(b).includes(title))
  if (all.length !== 1) throw new Error(`expected one button for "${title}", found ${all.length}`)
  return all[0]
}

async function say(text) {
  const input = t.container.querySelector('.prompt')
  input.value = text
  input.dispatchEvent(new Event('input', { bubbles: true }))
  await t.settle()
  const form = input.closest('form')
  form.requestSubmit()
  await t.settle()
}

/** the model calls ask_user; a card that composes from a catalog gets its result part */
async function ask(id = 'c1', need = 'Pick the session you will attend') {
  await t.stream('LLM', ['Let me ask. ', { toolCall: { id, name: 'ask_user', input: { need } } }])
  await t.settle()
  const composing = () => (t.state.assistant?.messages ?? []).some((m) => (m.parts ?? []).some((p) => p.toolCallId === id && p.ui?.status === 'composing'))
  if (composing()) {
    const catalog = catalogs.find((c) => Object.values(c.parts).some((p) => p.result))
    if (!catalog) throw new Error('a card is being composed, but no exported catalog with a result part was found in src/')
    const results = Object.entries(catalog.parts).filter(([, p]) => p.result)
    const [name] = results.find(([k, p]) => /session/i.test(`${k} ${p.description ?? ''}`)) ?? results[0]
    await composeWith(t, catalog, [{ part: name }])
    await t.settle()
  }
  await until(() => sessionButtons().length > 0, 'the session buttons')
}

describe('session card in the assistant', () => {
  it('chatting still works', async () => {
    await open()
    await say('When is the forms talk?')
    expect(chatReqs()).toHaveLength(1)
    expect(lastUserText(chatReqs()[0])).toBe('When is the forms talk?')
    await t.stream('LLM', ['At 14:00 ', 'in Hall A.'])
    await until(() => conversation().includes('At 14:00 in Hall A.'), 'the reply')
    expect(conversation()).toContain('When is the forms talk?')
  })

  it('offers the ask_user tool to the model', async () => {
    await open()
    await say('Help me choose a session')
    expect(toolNames(chatReqs()[0])).toContain('ask_user')
  })

  it("asking shows one button per session of the app's program, in the conversation", async () => {
    await open()
    await say('Help me choose a session')
    await ask()
    expect(sessionButtons()).toHaveLength(4)
    for (const title of Object.values(SESSIONS)) {
      const b = buttonFor(title)
      expect(b.disabled).toBe(false)
      expect(b.closest('.program')).toBe(null)
    }
    expect(conversation()).toContain('Let me ask.')
    expect(chatReqs()).toHaveLength(1)          // nothing goes back before the user answers
    expect(mySession()).toContain('none yet')
  })

  it("a click answers the call with the session's id, and the conversation goes on", async () => {
    await open()
    await say('Help me choose a session')
    await ask()
    buttonFor(SESSIONS.s3).click()
    await until(() => chatReqs().length === 2, 'the answer to be sent')
    const part = askPart(chatReqs()[1], 'c1')
    expect(part, 'the ask_user call is in the conversation sent back').toBeTruthy()
    expect(part.state).toBe('output-available')
    expect(mentions(part.output, 's3'), `the result names the session's id: ${JSON.stringify(part.output)}`).toBe(true)
    expect(mySession()).toContain(SESSIONS.s3)
    await t.stream('LLM', ['Great choice, see you in Hall A.'])
    await until(() => conversation().includes('Great choice, see you in Hall A.'), 'the reply')
  })

  it('the card answers once', async () => {
    await open()
    await say('Help me choose a session')
    await ask()
    buttonFor(SESSIONS.s2).click()
    await until(() => chatReqs().length === 2, 'the answer to be sent')
    await t.stream('LLM', ['Noted.'])
    await until(() => conversation().includes('Noted.'), 'the reply')
    const other = buttonFor(SESSIONS.s4)
    other.click()
    await t.settle()
    await t.settle()
    expect(chatReqs()).toHaveLength(2)
    expect(mySession()).toContain(SESSIONS.s2)
    expect(mySession()).not.toContain(SESSIONS.s4)
  })

  it('a second question gets its own card', async () => {
    await open()
    await say('Help me choose a session')
    await ask('c1')
    buttonFor(SESSIONS.s1).click()
    await until(() => chatReqs().length === 2, 'the first answer')
    await t.stream('LLM', ['Done.'])
    await until(() => conversation().includes('Done.'), 'the reply')
    await say('Actually, let me pick another one')
    expect(chatReqs()).toHaveLength(3)
    await ask('c2', 'Pick another session')
    // two cards now: the new one is the later one in the conversation
    const s4 = sessionButtons().filter((b) => textOf(b).includes(SESSIONS.s4))
    expect(s4).toHaveLength(2)
    s4[1].click()
    await until(() => chatReqs().length === 4, 'the second answer')
    expect(mentions(askPart(chatReqs()[3], 'c2').output, 's4')).toBe(true)
    expect(mentions(askPart(chatReqs()[3], 'c1').output, 's1')).toBe(true)
    expect(mySession()).toContain(SESSIONS.s4)
  })
})
