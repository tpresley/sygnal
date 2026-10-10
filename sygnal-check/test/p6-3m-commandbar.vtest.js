/**
 * PLAN-6 M-3: sygnal-check and the `commandBar` behavior from 'sygnal/ai' (FIRST_PARTY.commandBar
 * in src/model/behaviors.js): a command field next to a chat assistant is clean under --strict
 * (RUN, DECIDED, DONE come from outside the host's intent); a misspelled option is SYG127, a host
 * entry for an action the bar doesn't have is SYG102, and its field rendered only inside a child
 * is SYG104.
 */
import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { checkFiles } from '../src/index.js'

let tmp
afterEach(() => { if (tmp) fs.rmSync(tmp, { recursive: true, force: true }); tmp = null })

function check(files, opts = {}) {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sygnal-check-p6-3m-'))
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
import { commandBar, chat, messageText } from 'sygnal/ai'
import TodoItem from './TodoItem.jsx'

export default function TodoApp({ state }) {
  const { cmd } = state
  return (
    <main>
      <label>Command <input className="command" value={cmd.text} /></label>
      {cmd.pending && (
        <div role="alertdialog" aria-label="Confirm">
          <p>Run: {cmd.pending.description}?</p>
          <button type="button" className="yes">Run</button>
          <button type="button" className="no">Cancel</button>
        </div>
      )}
      {cmd.unsure && <p>Not sure what "{cmd.unsure.command}" means</p>}
      <button type="button" className="add">Add</button>
      <ul className="todos"><Collection of={TodoItem} from="todos" /></ul>
      <ol aria-live="polite">
        {state.assistant.messages.map((m, i) => <li key={i}>{messageText(m)}</li>)}
      </ol>
    </main>
  )
}

TodoApp.initialState = { todos: [], nextId: 1, ran: 0 }
// (an agent-only action is K-1's SYG102 change; here ADD also has a button)
TodoApp.intent = ({ DOM }) => ({ ADD: DOM.click('.add').map(() => 'new todo') })
TodoApp.model = {
  ADD: (state, text) => ({ ...state, todos: [...state.todos, { id: state.nextId, text, done: false }], nextId: state.nextId + 1 }),
  'cmd.DONE': (state) => ({ ...state, ran: state.ran + 1 }),
}
TodoApp.agent = {
  name: 'todos',
  read: (state) => ({ todos: state.todos }),
  actions: { ADD: { description: 'Add a new todo', input: z.string().min(1) } },
}
TodoApp.uses = {
  cmd: commandBar({
    input: '.command', approve: '.yes', deny: '.no',
    decide: { url: '/api/decide', model: 'jev-latest' },
    below: 0.6, escalate: 'assistant',
  }),
  assistant: chat({ instructions: 'You help the user manage this todo list.' }),
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
TodoItem.agent = { name: 'todo', label: (state) => state.text, actions: { TOGGLE: { description: 'Mark a todo done or not done' } } }
`

describe('commandBar behavior (sygnal/ai)', () => {
  it('a command field next to an assistant has no findings (strict)', () => {
    expect(check({ 'TodoApp.jsx': APP, 'TodoItem.jsx': ITEM }, { strict: true })).toEqual([])
  })

  it('a misspelled option is SYG127; a host entry for an action the bar lacks is SYG102', () => {
    const bad = APP.replace("below: 0.6,", "below: 0.6, escalte: 'assistant',").replace("'cmd.DONE'", "'cmd.DONEE'")
    const d = check({ 'TodoApp.jsx': bad, 'TodoItem.jsx': ITEM }, { strict: true })
    expect(codes(d)).toEqual(['SYG102 warn', 'SYG127 error'])
    expect(d.find(x => x.code === 'SYG127').message).toMatch(/did you mean 'escalate'/)
  })

  it('its field rendered only in a child component is SYG104', () => {
    const item = ITEM.replace('<label>', '<input className="command" /><label>')
    const app = APP.replace('<label>Command <input className="command" value={cmd.text} /></label>', '')
    expect(app).not.toBe(APP)
    expect(codes(check({ 'TodoApp.jsx': app, 'TodoItem.jsx': item }, { strict: true }))).toContain('SYG104 warn')
  })
})
