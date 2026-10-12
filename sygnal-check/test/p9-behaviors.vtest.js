/**
 * PLAN-9 polish: sygnal-check's FIRST_PARTY entries for the sygnal/ai behaviors PLAN-9 grew or
 * added (src/model/behaviors.js): chat's `ask` / `clientTools` options and its H-1..H-3 actions
 * (TOOL_CALL, TOOL_OUTPUT, ANSWER, CONTROL, CARD, CARD_FAILED, RESUME), and `compose(catalog, {
 * backend, form, prompt, key })` with its options in the 2nd argument.
 */
import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { checkFiles } from '../src/index.js'

let tmp
afterEach(() => { if (tmp) fs.rmSync(tmp, { recursive: true, force: true }); tmp = null })

function check(files, opts = {}) {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sygnal-check-p9-beh-'))
  for (const [rel, src] of Object.entries(files)) {
    const p = path.join(tmp, rel)
    fs.mkdirSync(path.dirname(p), { recursive: true })
    fs.writeFileSync(p, src)
  }
  return checkFiles(Object.keys(files).map(f => path.join(tmp, f)), { cwd: tmp, ...opts })
}
const codes = (diags) => diags.map(d => `${d.code} ${d.severity}`).sort()

const CHAT = `import { chat, defineCatalog, askCard, jsonSchema } from 'sygnal/ai'

const catalog = defineCatalog({ parts: {} })

export default function Assistant({ state }) {
  const a = state.assistant
  return (
    <div className="assistant">
      <ol>{a.messages.map((m) => <li>{m.parts.map((p) => p.type === 'tool-ask_user' ? askCard(catalog, state, p) : null)}</li>)}</ol>
      <form className="ask">
        <input className="prompt" aria-label="Message" value={a.prompt} />
        <button type="button" className="stop">Stop</button>
      </form>
    </div>
  )
}
Assistant.initialState = { located: 0 }
Assistant.model = {
  'assistant.TOOL_CALL': (state) => ({ ...state, located: state.located + 1 }),
  'assistant.DONE': (state) => state,
}
Assistant.uses = {
  assistant: chat({
    model: (state) => state.chatModel,
    form: '.ask', prompt: '.prompt', stop: '.stop',
    clientTools: { locate: { description: 'Where the user is', inputSchema: jsonSchema({ type: 'object' }) } },
    ask: { catalog },
  }),
}
`

const PAGE = `import { compose, defineCatalog } from 'sygnal/ai'

const catalog = defineCatalog({ parts: {} })

export default function Page({ state }) {
  return (
    <main>
      <form className="ask"><input className="prompt" aria-label="Message" value={state.page.prompt} /></form>
      {catalog.render(state.page, state)}
    </main>
  )
}
Page.initialState = { done: 0 }
Page.model = {
  'page.DONE': (state) => ({ ...state, done: state.done + 1 }),
}
Page.uses = {
  page: compose(catalog, { backend: compose.llm({ model: 'qwen3:8b' }), form: '.ask', prompt: '.prompt', key: 'page' }),
}
`

describe('chat (PLAN-9 options and actions)', () => {
  it('ask, clientTools and a TOOL_CALL host entry are clean (strict)', () => {
    expect(check({ 'Assistant.jsx': CHAT }, { strict: true })).toEqual([])
  })

  it('a misspelled option is still SYG127; a host entry for an action chat lacks is SYG102', () => {
    const bad = CHAT.replace('ask: { catalog }', 'aks: { catalog }').replace("'assistant.TOOL_CALL'", "'assistant.TOOL_CALLED'")
    const d = check({ 'Assistant.jsx': bad }, { strict: true })
    expect(codes(d)).toEqual(['SYG102 warn', 'SYG127 error'])
    expect(d.find(x => x.code === 'SYG127').message).toMatch(/has no option 'aks'.*clientTools, ask/)
  })

  it.each(['TOOL_OUTPUT', 'ANSWER', 'CONTROL', 'CARD', 'CARD_FAILED', 'RESUME'])('a host entry for %s is clean', (a) => {
    expect(check({ 'Assistant.jsx': CHAT.replace("'assistant.DONE'", `'assistant.${a}'`) }, { strict: true })).toEqual([])
  })
})

describe('compose(catalog, options)', () => {
  it('its options (2nd argument) and a DONE host entry are clean (strict)', () => {
    expect(check({ 'Page.jsx': PAGE }, { strict: true })).toEqual([])
  })

  it('a misspelled option is SYG127; a host entry for an action compose lacks is SYG102', () => {
    const bad = PAGE.replace("key: 'page'", "kye: 'page'").replace("'page.DONE'", "'page.DONEE'")
    const d = check({ 'Page.jsx': bad }, { strict: true })
    expect(codes(d)).toEqual(['SYG102 warn', 'SYG127 error'])
    expect(d.find(x => x.code === 'SYG127').message).toMatch(/has no option 'kye'.*backend, form, prompt, key/)
  })

  it.each(['COMPOSE', 'SET_LAYOUT', 'REMOVE', 'CONTROL', 'REPLY', 'DELTA', 'FAILED'])('a host entry for %s is clean', (a) => {
    expect(check({ 'Page.jsx': PAGE.replace("'page.DONE'", `'page.${a}'`) }, { strict: true })).toEqual([])
  })
})
