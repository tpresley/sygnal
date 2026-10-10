/**
 * PLAN-6 L-3: sygnal-check and the `chat` behavior from 'sygnal/ai' (FIRST_PARTY.chat in
 * src/model/behaviors.js): the samples' assistant (the panel markup in a helper function the host
 * view calls) is clean under --strict; a misspelled option is SYG127, a host entry for an action
 * chat doesn't have is SYG102, and a selector rendered only inside a child is SYG104.
 */
import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { checkFiles } from '../src/index.js'

let tmp
afterEach(() => { if (tmp) fs.rmSync(tmp, { recursive: true, force: true }); tmp = null })

function check(files, opts = {}) {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sygnal-check-p6-2c-'))
  for (const [rel, src] of Object.entries(files)) {
    const p = path.join(tmp, rel)
    fs.mkdirSync(path.dirname(p), { recursive: true })
    fs.writeFileSync(p, src)
  }
  return checkFiles(Object.keys(files).map(f => path.join(tmp, f)), { cwd: tmp, ...opts })
}
const codes = (diags) => diags.map(d => `${d.code} ${d.severity}`).sort()

const APP = `import { z } from 'zod'
import { Collection } from 'sygnal'
import { chat, messageText } from 'sygnal/ai'
import TodoItem from './TodoItem.jsx'

export default function TodoApp({ state }) {
  return (
    <main>
      <form className="new">
        <label>New todo <input className="text" value={state.text} /></label>
      </form>
      <ul className="todos"><Collection of={TodoItem} from="todos" /></ul>
      {assistantPanel(state.assistant)}
    </main>
  )
}

function assistantPanel(a) {
  return (
    <aside className="assistant">
      <ol aria-live="polite">
        {a.messages.map((m, i) => <li key={i} className={m.role}>{messageText(m)}</li>)}
        {a.draft && <li className="assistant">{a.draft}</li>}
      </ol>
      {a.pending && (
        <div role="alertdialog" aria-label="Confirm">
          <p>The assistant wants to: {a.pending.description}</p>
          <button type="button" className="approve">Allow</button>
          <button type="button" className="deny">Deny</button>
        </div>
      )}
      <form className="ask">
        <label>Ask <input className="prompt" value={a.prompt} /></label>
        <button type="submit" disabled={a.status === 'streaming'}>Send</button>
        <button type="button" className="stop" hidden={a.status !== 'streaming'}>Stop</button>
      </form>
    </aside>
  )
}

TodoApp.initialState = { todos: [], text: '', filter: 'all', nextId: 1, finished: 0 }
TodoApp.intent = ({ DOM }) => ({
  TYPE: DOM.input('.text').value(),
  SUBMIT: DOM.select('.new').events('submit', { preventDefault: true }),
})
const addTodo = (state, text) => ({ todos: [...state.todos, { id: state.nextId, text, done: false }], nextId: state.nextId + 1 })
TodoApp.model = {
  TYPE: (state, text) => ({ ...state, text }),
  SUBMIT: (state) => ({ ...state, ...addTodo(state, state.text), text: '' }),
  'assistant.DONE': (state) => ({ ...state, finished: state.finished + 1 }),
}
TodoApp.uses = {
  assistant: chat({
    sink: 'LLM',
    form: '.ask', prompt: '.prompt', stop: '.stop',
    approve: '.approve', deny: '.deny',
    instructions: 'You help the user manage this todo list.',
  }),
}
`
const ITEM = `export default function TodoItem({ state }) {
  return (
    <li>
      <label><input type="checkbox" className="done" checked={state.done} /> {state.text}</label>
    </li>
  )
}
TodoItem.intent = ({ DOM }) => ({ TOGGLE: DOM.change('.done') })
TodoItem.model = {
  TOGGLE: (state) => ({ ...state, done: !state.done }),
}
`

describe('chat behavior (sygnal/ai)', () => {
  it("the samples' assistant has no findings (strict)", () => {
    expect(check({ 'TodoApp.jsx': APP, 'TodoItem.jsx': ITEM }, { strict: true })).toEqual([])
  })

  it('a misspelled option is SYG127; a host entry for an action chat lacks is SYG102', () => {
    const bad = APP.replace("deny: '.deny',", "deny: '.deny', aprove: '.approve',").replace("'assistant.DONE'", "'assistant.DONEE'")
    const d = check({ 'TodoApp.jsx': bad, 'TodoItem.jsx': ITEM }, { strict: true })
    expect(codes(d)).toEqual(['SYG102 warn', 'SYG127 error'])
    expect(d.find(x => x.code === 'SYG127').message).toMatch(/did you mean 'approve'/)
  })

  it('a selector rendered only in a child component is SYG104', () => {
    const item = ITEM.replace('<label>', '<button type="button" className="stop">Stop</button><label>')
    const app = APP.replace(`<button type="button" className="stop" hidden={a.status !== 'streaming'}>Stop</button>`, '')
    expect(app).not.toBe(APP)
    expect(codes(check({ 'TodoApp.jsx': app, 'TodoItem.jsx': item }, { strict: true }))).toContain('SYG104 warn')
  })
})
