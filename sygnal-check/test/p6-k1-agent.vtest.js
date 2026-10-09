/**
 * PLAN-6 K-1: sygnal-check rules for `sygnal/ai`.
 *
 *   SYG102  agent.actions entries and an LLM request's delta / tool reply keys are triggers (G-614),
 *           also through a local helper that builds the request (0-S5)
 *   SYG150  agent.actions key with no model entry          SYG151  misspelled agent static
 *   SYG152  LLM request without ok                          SYG153  bare toolname on a <form> (D269)
 *   SYG240  Valibot without toStandardJsonSchema(), Zod Mini, raw JSON Schema (G-611)
 *   SYG243  a Date in an input (G-611)
 *   SYG440  two declarations with one name in one app       SYG441  Collection items without ids
 *   SYG730  hover-only action                               SYG731  toggled class without ARIA state
 *   --graph / MCP graph: the agent declaration, trigger 'agent'
 */
import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { checkFiles, graphFiles, validateSchema, CODES } from '../src/index.js'
import { formatGraph } from '../src/graphText.js'
import { createMcpServer } from '../src/mcp.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const schema = JSON.parse(fs.readFileSync(path.join(here, '../schema/inspect.schema.json'), 'utf8'))

let tmp
afterEach(() => { if (tmp) fs.rmSync(tmp, { recursive: true, force: true }); tmp = null })

function write(files) {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sygnal-check-p6-k1-'))
  for (const [rel, src] of Object.entries(files)) {
    const p = path.join(tmp, rel)
    fs.mkdirSync(path.dirname(p), { recursive: true })
    fs.writeFileSync(p, src)
  }
  return Object.keys(files).map(f => path.join(tmp, f))
}
const check = (files, opts = {}) => checkFiles(write(files), { cwd: tmp, ...opts })
const codes = (diags, re = /./) => diags.filter(d => re.test(d.code)).map(d => `${d.code} ${d.line}`)
const only = (code) => (diags) => diags.filter(d => d.code === code)

// ---------------------------------------------------------------------------
// The samples' TodoApp (research/llm-integration-samples.md §3, §4): clean under --strict

const TODO_APP = `import { z } from 'zod'
import { Collection } from 'sygnal'
import TodoItem from './TodoItem.jsx'

export default function TodoApp({ state }) {
  return (
    <main>
      <form className="new">
        <label>New todo <input className="text" value={state.text} /></label>
      </form>
      <ul className="todos"><Collection of={TodoItem} from="todos" /></ul>
      <button type="button" className="clear" disabled={!state.todos.some((t) => t.done)}>Clear done</button>
    </main>
  )
}

TodoApp.initialState = { todos: [], text: '', filter: 'all', nextId: 1 }
TodoApp.intent = ({ DOM }) => ({
  TYPE: DOM.input('.text').value(),
  SUBMIT: DOM.select('.new').events('submit', { preventDefault: true }),
  CLEAR_DONE: DOM.click('.clear'),
})
TodoApp.model = {
  TYPE: (state, text) => ({ ...state, text }),
  SUBMIT: (state) => ({ ...state, ...addTodo(state, state.text), text: '' }),
  ADD: (state, text) => ({ ...state, ...addTodo(state, text) }),
  SET_FILTER: (state, filter) => ({ ...state, filter }),
  CLEAR_DONE: (state) => ({ ...state, todos: state.todos.filter((t) => !t.done) }),
}
const addTodo = (state, text) => ({ todos: [...state.todos, { id: state.nextId, text, done: false }], nextId: state.nextId + 1 })

TodoApp.agent = {
  name: 'todos',
  description: 'The todo list',
  read: (state) => ({ todos: state.todos.map(({ id, text, done }) => ({ id, text, done })), filter: state.filter }),
  actions: {
    ADD: { description: 'Add a todo', input: z.string().min(1).describe('The todo text') },
    SET_FILTER: { description: 'Which todos to show', input: z.enum(['all', 'active', 'done']) },
    CLEAR_DONE: {
      description: 'Delete every todo that is done',
      consequential: true,
      when: (state) => state.todos.some((t) => t.done),
    },
  },
}
`
const TODO_ITEM = `export default function TodoItem({ state }) {
  return (
    <li>
      <label><input type="checkbox" className="done" checked={state.done} /> {state.text}</label>
      <button type="button" className="remove" aria-label={\`Remove \${state.text}\`}>×</button>
    </li>
  )
}
TodoItem.intent = ({ DOM }) => ({ TOGGLE: DOM.change('.done'), REMOVE: DOM.click('.remove') })
TodoItem.model = {
  TOGGLE: (state) => ({ ...state, done: !state.done }),
  REMOVE: () => undefined,
}
TodoItem.agent = {
  name: 'todo',
  description: 'A todo',
  actions: {
    TOGGLE: { description: 'Mark the todo done, or not done again' },
    REMOVE: { description: 'Delete the todo', consequential: true },
  },
}
`

describe('the samples are clean', () => {
  it('TodoApp + TodoItem (§3): no findings under --strict (ADD / SET_FILTER are agent-only, not SYG102)', () => {
    expect(codes(check({ 'TodoApp.jsx': TODO_APP, 'TodoItem.jsx': TODO_ITEM }, { strict: true }))).toEqual([])
  })

  it('the same entries without the agent declaration are SYG102', () => {
    const src = TODO_APP.replace(/TodoApp\.agent = \{[\s\S]*$/, '')
    expect(codes(check({ 'TodoApp.jsx': src, 'TodoItem.jsx': TODO_ITEM }), /SYG102/).length).toBe(2)
  })
})

// ---------------------------------------------------------------------------
// SYG102 and LLM reply keys (G-614)

const chat = (llm, extra = '') => `export default function Chat({ state }) {
  return <form className="ask"><label>Ask <input className="prompt" value={state.prompt} /></label><button type="submit">Send</button></form>
}
Chat.initialState = { messages: [], prompt: '', draft: '' }
Chat.intent = ({ DOM }) => ({ TYPE: DOM.input('.prompt').value(), SEND: DOM.select('.ask').events('submit', { preventDefault: true }) })
Chat.model = {
  TYPE: (state, prompt) => ({ ...state, prompt }),
  SEND: { LLM: ${llm} },
  DELTA: (state, { text }) => ({ ...state, draft: text }),
  TOOL: (state, { call }) => ({ ...state, call }),
  DONE: (state, { message }) => ({ ...state, messages: [...state.messages, message], draft: '' }),
  FAILED: (state) => ({ ...state, draft: '' }),
}
${extra}`

describe('SYG102: LLM reply keys (G-614)', () => {
  it('delta / tool / ok / error of a request with messages are triggers', () => {
    const d = check({ 'Chat.jsx': chat("(state) => ({ messages: state.messages, delta: 'DELTA', tool: 'TOOL', ok: 'DONE', error: 'FAILED' })") })
    expect(codes(d)).toEqual([])
  })

  it('follows a local helper that builds the request (0-S5)', () => {
    const d = check({ 'Chat.jsx': chat('(state) => ask(state.messages)', "const ask = (messages) => ({ messages, delta: 'DELTA', tool: 'TOOL', ok: 'DONE', error: 'FAILED' })") })
    expect(codes(d)).toEqual([])
    const d2 = check({ 'Chat.jsx': chat('(state) => ask(state.messages)', "function ask(messages) { return { messages, delta: 'DELTA', tool: 'TOOL', ok: 'DONE', error: 'FAILED' } }") })
    expect(codes(d2)).toEqual([])
  })

  it('a request to the LLM sink counts delta / tool even without a literal messages key', () => {
    const d = check({ 'Chat.jsx': chat("(state) => ({ ...state.request, delta: 'DELTA', tool: 'TOOL', ok: 'DONE', error: 'FAILED' })") })
    expect(codes(d, /SYG102/)).toEqual([])
  })

  it('delta / tool on a request that is not an LLM one are not reply keys', () => {
    const src = chat("(state) => ({ messages: [], ok: 'DONE', error: 'FAILED' })").replace("SEND: { LLM: (state) => ({ messages: [], ok: 'DONE', error: 'FAILED' }) },",
      "SEND: { LLM: (state) => ({ messages: [], ok: 'DONE', error: 'FAILED' }), HTTP: () => ({ url: '/x', delta: 'DELTA', tool: 'TOOL' }) },")
    expect(codes(check({ 'Chat.jsx': src }), /SYG102/)).toEqual(['SYG102 9', 'SYG102 10'])
  })

  it('a delta naming a missing entry is SYG112', () => {
    const d = check({ 'Chat.jsx': chat("(state) => ({ messages: state.messages, delta: 'DELTAS', tool: 'TOOL', ok: 'DONE', error: 'FAILED' })") })
    expect(d.filter(x => x.code === 'SYG112').map(x => x.data.action ?? x.message)).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// SYG152

describe('SYG152: LLM request without ok', () => {
  const syg152 = only('SYG152')
  it('reports a request with messages and no ok (also through a helper)', () => {
    const d = check({ 'Chat.jsx': chat("(state) => ({ messages: state.messages, delta: 'DELTA', error: 'FAILED' })") })
    expect(syg152(d).map(x => x.line)).toEqual([8])
    expect(syg152(d)[0].message).toMatch(/no ok reply action/)
    const d2 = check({ 'Chat.jsx': chat('(state) => ask(state.messages)', "const ask = (messages) => ({ messages, delta: 'DELTA' })") })
    expect(syg152(d2).map(x => x.line)).toEqual([14])
  })
  it('is quiet with ok, a spread, an abort, or a url', () => {
    expect(syg152(check({ 'Chat.jsx': chat("(state) => ({ messages: state.messages, ok: 'DONE' })") }))).toEqual([])
    expect(syg152(check({ 'Chat.jsx': chat("(state) => ({ ...base, messages: state.messages })", 'const base = {}') }))).toEqual([])
    expect(syg152(check({ 'Chat.jsx': chat("() => ({ abort: 'reply' })") }))).toEqual([])
    expect(syg152(check({ 'Chat.jsx': chat("(state) => ({ url: '/api', messages: state.messages })") }))).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// SYG150 / SYG151

const counter = (agentSrc, extra = '') => `import { z } from 'zod'
export default function Counter({ state }) {
  return <p>{state.count}</p>
}
Counter.initialState = { count: 0 }
Counter.model = {
  INCREMENT: (state) => ({ ...state, count: state.count + 1 }),
  SET: (state, n) => ({ ...state, count: n }),
}
${agentSrc}
${extra}`

describe('SYG150: agent action without a model entry', () => {
  const syg150 = only('SYG150')
  it('reports it, with the closest entry', () => {
    const d = check({ 'Counter.jsx': counter("Counter.agent = { actions: { INCREMNT: { description: 'Add one' }, SET: { description: 'Set', input: z.number() }, RESET: { description: 'Back to 0' } } }") })
    expect(syg150(d).map(x => x.data)).toEqual([{ action: 'INCREMNT', suggestion: 'INCREMENT' }, { action: 'RESET' }])
    expect(syg150(d)[0].severity).toBe('warn')
    expect(codes(d, /SYG102/)).toEqual(['SYG102 7']) // INCREMENT: the typo leaves it untriggered
  })
  it('is quiet when every action has an entry, or the model or actions have spreads', () => {
    expect(syg150(check({ 'Counter.jsx': counter("Counter.agent = { actions: { INCREMENT: { description: 'Add one' }, SET: { description: 'Set', input: z.number() } } }") }))).toEqual([])
    expect(syg150(check({ 'Counter.jsx': counter("Counter.agent = { actions: { ...more, RESET: { description: 'x' } } }", 'const more = {}') }))).toEqual([])
    const spreadModel = counter("Counter.agent = { actions: { RESET: { description: 'x' } } }").replace('Counter.model = {', 'Counter.model = { ...shared,') + '\nconst shared = {}'
    expect(syg150(check({ 'Counter.jsx': spreadModel }))).toEqual([])
  })
  it("counts a behavior's own actions ('pager.NEXT')", () => {
    const src = `import { pager } from 'sygnal'
export default function List({ state }) { return <div><button type="button" className="next">Next</button></div> }
List.initialState = { items: [] }
List.uses = { pager: pager({ next: '.next' }) }
List.agent = { actions: { 'pager.NEXT': { description: 'Next page' } } }
`
    expect(syg150(check({ 'List.jsx': src }))).toEqual([])
  })
})

describe('SYG151: misspelled agent static', () => {
  const syg151 = only('SYG151')
  it('reports agents / tools / Agent on a component', () => {
    for (const name of ['agents', 'tools', 'Agent']) {
      const d = check({ 'Counter.jsx': counter(`Counter.${name} = { actions: { INCREMENT: { description: 'Add one' } } }`) })
      expect(syg151(d).map(x => x.data), name).toEqual([{ static: name, expected: 'agent' }])
      expect(syg151(d)[0].message).toContain('did you mean `agent`?')
    }
  })
  it('is quiet for agent, and for a non-component object with a tools key', () => {
    expect(syg151(check({ 'Counter.jsx': counter("Counter.agent = { actions: { INCREMENT: { description: 'Add one' } } }") }))).toEqual([])
    expect(syg151(check({ 'Counter.jsx': counter('', "const config = {}\nconfig.tools = ['a', 'b']") }))).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// SYG240 / SYG243 (G-611)

describe('SYG240 / SYG243: agent input schemas (G-611)', () => {
  const withInput = (imports, input, extra = '') => counter(`Counter.agent = { actions: { SET: { description: 'Set', input: ${input} } } }`, extra).replace("import { z } from 'zod'", imports)
  const kinds = (d) => d.filter(x => x.code === 'SYG240' || x.code === 'SYG243').map(x => `${x.code} ${x.data.kind ?? ''}`.trim())

  it('reports an unwrapped Valibot schema, Zod Mini and a raw JSON Schema object', () => {
    expect(kinds(check({ 'Counter.jsx': withInput("import * as v from 'valibot'", 'v.pipe(v.number(), v.integer())') }))).toEqual(['SYG240 valibot'])
    expect(kinds(check({ 'Counter.jsx': withInput("import { number } from 'valibot'", 'number()') }))).toEqual(['SYG240 valibot'])
    expect(kinds(check({ 'Counter.jsx': withInput("import * as z from 'zod/mini'", 'z.number()') }))).toEqual(['SYG240 zod-mini'])
    expect(kinds(check({ 'Counter.jsx': withInput('', "{ type: 'integer' }") }))).toEqual(['SYG240 json'])
    // through a const, from another module
    const d = check({
      'Counter.jsx': withInput("import { Count } from './schemas.js'", 'Count'),
      'schemas.js': "import * as v from 'valibot'\nexport const Count = v.number()\n",
    })
    expect(kinds(d)).toEqual(['SYG240 valibot'])
    expect(only('SYG240')(d)[0].severity).toBe('error')
  })

  it('accepts toStandardJsonSchema(), jsonSchema(), Zod and ArkType', () => {
    const imports = "import * as v from 'valibot'\nimport { toStandardJsonSchema } from '@valibot/to-json-schema'"
    expect(kinds(check({ 'Counter.jsx': withInput(imports, 'toStandardJsonSchema(v.number())') }))).toEqual([])
    expect(kinds(check({ 'Counter.jsx': withInput("import { jsonSchema } from 'sygnal/ai'", "jsonSchema({ type: 'integer' })") }))).toEqual([])
    expect(kinds(check({ 'Counter.jsx': withInput("import { z } from 'zod'", 'z.number().int()') }))).toEqual([])
    expect(kinds(check({ 'Counter.jsx': withInput("import { type } from 'arktype'", "type('number.integer')") }))).toEqual([])
  })

  it('reports a Date in an input (Zod, Valibot, ArkType), also nested in a const', () => {
    expect(kinds(check({ 'Counter.jsx': withInput("import { z } from 'zod'", 'z.object({ due: z.date() })') }))).toEqual(['SYG243'])
    expect(kinds(check({ 'Counter.jsx': withInput("import { z } from 'zod'", 'z.coerce.date()') }))).toEqual(['SYG243'])
    expect(kinds(check({ 'Counter.jsx': withInput("import { z } from 'zod'", 'Due', 'const Due = z.object({ title: z.string(), due: z.date().optional() })') }))).toEqual(['SYG243'])
    const vimports = "import * as v from 'valibot'\nimport { toStandardJsonSchema } from '@valibot/to-json-schema'"
    expect(kinds(check({ 'Counter.jsx': withInput(vimports, 'toStandardJsonSchema(v.object({ due: v.date() }))') }))).toEqual(['SYG243'])
    expect(kinds(check({ 'Counter.jsx': withInput("import { type } from 'arktype'", "type({ due: 'Date' })") }))).toEqual(['SYG243'])
    expect(only('SYG243')(check({ 'Counter.jsx': withInput("import { z } from 'zod'", 'z.date()') }))[0].fix).toMatch(/z\.iso\.datetime\(\)/)
  })

  it('accepts ISO date strings', () => {
    expect(kinds(check({ 'Counter.jsx': withInput("import { z } from 'zod'", 'z.iso.datetime()') }))).toEqual([])
    expect(kinds(check({ 'Counter.jsx': withInput("import { type } from 'arktype'", "type({ due: 'string.date.iso' })") }))).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// SYG440 / SYG441

describe('SYG440: two declarations with the same name in one app', () => {
  const syg440 = only('SYG440')
  const panel = (name, decl) => `export default function ${name}({ state }) { return <p>{state.x}</p> }
${name}.model = { PING: (state) => ({ ...state }) }
${name}.agent = ${decl}
`
  it('reports it when one component renders both', () => {
    const d = check({
      'App.jsx': "import Left from './Left.jsx'\nimport Right from './Right.jsx'\nexport default function App() { return <div><Left /><Right /></div> }\nApp.initialState = { x: 1 }\n",
      'Left.jsx': panel('Left', "{ name: 'panel', actions: { PING: { description: 'Ping' } } }"),
      'Right.jsx': panel('Right', "{ name: 'panel', actions: { PING: { description: 'Ping' } } }"),
    })
    expect(syg440(d).map(x => x.data)).toEqual([{ name: 'panel', other: 'Left' }])
  })
  it('is quiet for different names, or declarations in separate apps', () => {
    expect(syg440(check({
      'App.jsx': "import Left from './Left.jsx'\nimport Right from './Right.jsx'\nexport default function App() { return <div><Left /><Right /></div> }\nApp.initialState = { x: 1 }\n",
      'Left.jsx': panel('Left', "{ name: 'left', actions: { PING: { description: 'Ping' } } }"),
      'Right.jsx': panel('Right', "{ actions: { PING: { description: 'Ping' } } }"),
    }))).toEqual([])
    expect(syg440(check({
      'Left.jsx': panel('Left', "{ name: 'panel', actions: { PING: { description: 'Ping' } } }"),
      'Right.jsx': panel('Right', "{ name: 'panel', actions: { PING: { description: 'Ping' } } }"),
    }))).toEqual([])
  })
})

describe('SYG441: Collection item agent, items without ids', () => {
  const syg441 = only('SYG441')
  const app = (init, add) => TODO_APP
    .replace("TodoApp.initialState = { todos: [], text: '', filter: 'all', nextId: 1 }", `TodoApp.initialState = { todos: ${init}, text: '', filter: 'all', nextId: 1 }`)
    .replace("todos: [...state.todos, { id: state.nextId, text, done: false }]", `todos: [...state.todos, ${add}]`)
  it('reports an initial item without id, or one the model appends without id', () => {
    const d = check({ 'TodoApp.jsx': app("[{ text: 'water plants', done: false }]", '{ id: state.nextId, text, done: false }'), 'TodoItem.jsx': TODO_ITEM })
    expect(syg441(d).map(x => x.data)).toEqual([{ item: 'TodoItem', parent: 'TodoApp', from: 'todos' }])
    expect(syg441(d)[0].message).toContain('TodoApp.initialState.todos')
    const d2 = check({ 'TodoApp.jsx': app('[]', '{ text, done: false }'), 'TodoItem.jsx': TODO_ITEM })
    expect(syg441(d2).map(x => x.message)).toEqual([expect.stringContaining('TodoApp.model')])
  })
  it('is quiet with ids, spreads, or an item without an agent', () => {
    expect(syg441(check({ 'TodoApp.jsx': app("[{ id: 1, text: 'a' }]", '{ id: state.nextId, text }'), 'TodoItem.jsx': TODO_ITEM }))).toEqual([])
    expect(syg441(check({ 'TodoApp.jsx': app('[{ ...seed }]', '{ ...draft }'), 'TodoItem.jsx': TODO_ITEM }))).toEqual([])
    const noAgent = TODO_ITEM.replace(/TodoItem\.agent = \{[\s\S]*$/, '')
    expect(syg441(check({ 'TodoApp.jsx': app("[{ text: 'a' }]", '{ text }'), 'TodoItem.jsx': noAgent }))).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// SYG153 (D269)

describe('SYG153: WebMCP form attributes written as properties', () => {
  const form = (attrs, field = '') => `export default function Signup({ state }) {
  return <form ${attrs}><label>Email <input name="email" ${field} /></label><button type="submit">Sign up</button></form>
}
Signup.initialState = {}
`
  const syg153 = (d) => only('SYG153')(d).map(x => x.data.attribute)
  it('reports a bare toolname / tooldescription on a form and toolparamdescription on a field', () => {
    expect(syg153(check({ 'Signup.jsx': form('toolname="sign_up" tooldescription="Create an account"', 'toolparamdescription="Your email"') })))
      .toEqual(['toolname', 'tooldescription', 'toolparamdescription'])
  })
  it('the fix points at form(…, { tool }) (A-3), then attrs-*', () => {
    const d = only('SYG153')(check({ 'Signup.jsx': form('toolname="sign_up"', 'toolparamdescription="Your email"') }))
    expect(d[0].fix).toMatch(/form\(schema, \{ \.\.\., tool: formTool\(\{ name: 'sign_up'.*from 'sygnal\/ai'/)
    expect(d[0].fix).toMatch(/attrs-toolname=/)
    expect(d[1].fix).toMatch(/<label> or aria-label/)
    expect(d[1].fix).toMatch(/attrs-toolparamdescription=/)
  })
  it('accepts attrs-*, attrs={{ }}, and toolname on something else', () => {
    expect(syg153(check({ 'Signup.jsx': form('attrs-toolname="sign_up" attrs-tooldescription="Create"', 'attrs-toolparamdescription="Your email"') }))).toEqual([])
    expect(syg153(check({ 'Signup.jsx': form("attrs={{ toolname: 'sign_up' }}") }))).toEqual([])
    expect(syg153(check({ 'Signup.jsx': form('className="f"').replace('<label>', '<label toolname="x">') }))).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// SYG730 / SYG731 (the a11y lane)

describe('SYG730: action reachable only by hovering', () => {
  const card = (intent, model = "SHOW: (state) => ({ ...state, open: true }), HIDE: (state) => ({ ...state, open: false })", extra = '') => `import xs from 'xstream'
export default function Card({ state }) {
  return <div><button type="button" className="card">Details</button>{state.open && <p>More</p>}</div>
}
Card.initialState = { open: false }
Card.intent = ({ DOM }) => (${intent})
Card.model = { ${model} }
${extra}`
  const syg730 = (d) => codes(d, /SYG730/)
  it('reports an action only mouseenter / mouseover triggers', () => {
    const d = check({ 'Card.jsx': card("{ SHOW: DOM.mouseenter('.card'), HIDE: DOM.mouseleave('.card') }") })
    expect(syg730(d)).toEqual(['SYG730 6'])
    expect(only('SYG730')(d)[0].data).toEqual({ action: 'SHOW', events: ['mouseenter'] })
    expect(syg730(check({ 'Card.jsx': card("{ SHOW: DOM.select('.card').events('mouseover').mapTo(true), HIDE: DOM.mouseleave('.card') }") }))).toEqual(['SYG730 6'])
    // --a11y=error makes it an error
    expect(only('SYG730')(check({ 'Card.jsx': card("{ SHOW: DOM.mouseenter('.card'), HIDE: DOM.mouseleave('.card') }") }, { a11y: 'error' }))[0].severity).toBe('error')
  })
  it('is quiet with a focus or click path, next(), a local stream, or no state change', () => {
    expect(syg730(check({ 'Card.jsx': card("{ SHOW: xs.merge(DOM.mouseenter('.card'), DOM.focusin('.card')), HIDE: DOM.mouseleave('.card') }") }))).toEqual([])
    expect(syg730(check({ 'Card.jsx': card("{ SHOW: DOM.mouseenter('.card'), HIDE: DOM.mouseleave('.card'), OPEN: DOM.click('.card') }",
      "SHOW: (state) => ({ ...state, open: true }), HIDE: (state) => ({ ...state, open: false }), OPEN: { STATE: (state) => state, EFFECT: (state, d, next) => next('SHOW') }") }))).toEqual([])
    expect(syg730(check({ 'Card.jsx': card("{ SHOW: xs.merge(DOM.mouseenter('.card'), keys$), HIDE: DOM.mouseleave('.card') }").replace('Card.intent = ({ DOM }) => (', "const keys$ = xs.empty()\nCard.intent = ({ DOM }) => (") }))).toEqual([])
    expect(syg730(check({ 'Card.jsx': card("{ PREFETCH: DOM.mouseenter('.card') }", "PREFETCH: { HTTP: () => ({ url: '/details' }) }") }))).toEqual([])
    expect(syg730(check({ 'Card.jsx': `// sygnal-ignore-next-line SYG730\n` + card("{ SHOW: DOM.mouseenter('.card'), HIDE: DOM.mouseleave('.card') }") }))).toHaveLength(1) // ignore applies to its line only
  })
})

describe('SYG731: toggled class without ARIA state', () => {
  const toggle = (button, model = 'TOGGLE: (state) => ({ ...state, on: !state.on })', intent = "TOGGLE: DOM.click('.star')") => `export default function Star({ state }) {
  return <div>${button}</div>
}
Star.initialState = { on: false, filter: 'all' }
Star.intent = ({ DOM }) => ({ ${intent} })
Star.model = { ${model} }
`
  const syg731 = (d) => codes(d, /SYG731/)
  it('reports a click target whose class follows the field its reducer toggles', () => {
    const d = check({ 'Star.jsx': toggle('<button type="button" className={{ star: true, on: state.on }}>Star</button>') })
    expect(syg731(d)).toEqual(['SYG731 2'])
    expect(only('SYG731')(d)[0].fix).toContain('aria-pressed={state.on}')
    expect(syg731(check({ 'Star.jsx': toggle('<button type="button" className={state.on ? "star on" : "star"}>Star</button>') }))).toEqual(['SYG731 2'])
    // a selection: an equality on a field the reducer writes
    const sel = toggle('<button type="button" className={{ star: true, selected: state.filter === "done" }}>Done</button>', "PICK: (state) => ({ ...state, filter: 'done' })", "PICK: DOM.click('.star')")
    expect(syg731(check({ 'Star.jsx': sel }))).toEqual(['SYG731 2'])
  })
  it('is quiet with an ARIA state, a native control, a busy class, or a class on another element', () => {
    expect(syg731(check({ 'Star.jsx': toggle('<button type="button" className={{ star: true, on: state.on }} aria-pressed={state.on}>Star</button>') }))).toEqual([])
    expect(syg731(check({ 'Star.jsx': toggle('<input type="checkbox" className={{ star: true, on: state.on }} aria-label="Star" />') }))).toEqual([])
    expect(syg731(check({ 'Star.jsx': toggle('<button type="button" className={{ star: true, busy: state.on }}>Save</button>', 'TOGGLE: (state) => ({ ...state, on: true })') }))).toEqual([])
    expect(syg731(check({ 'Star.jsx': toggle('<span className={{ on: state.on }}><button type="button" className="star">Star</button></span>') }))).toEqual([])
    expect(syg731(check({ 'Star.jsx': toggle('<button type="button" className={{ star: true, on: state.on }} {...state.attrs}>Star</button>') }))).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// --graph and the MCP graph tool

describe('graph: agent declarations', () => {
  it('lists the declaration and agent-only actions; validates against the schema', () => {
    const files = write({ 'TodoApp.jsx': TODO_APP, 'TodoItem.jsx': TODO_ITEM })
    const g = graphFiles(files, { cwd: tmp })
    expect(validateSchema(schema, g)).toEqual([])
    const app = g.components.find(c => c.name === 'TodoApp')
    expect(app.agent).toEqual({
      name: 'todos', tools: 'todos', description: 'The todo list', read: true,
      actions: [
        { name: 'ADD', consequential: false, input: true },
        { name: 'SET_FILTER', consequential: false, input: true },
        { name: 'CLEAR_DONE', consequential: true, input: false },
      ],
    })
    expect(app.actions.filter(a => a.trigger === 'agent').map(a => a.name)).toEqual(['ADD', 'SET_FILTER'])
    expect(g.components.find(c => c.name === 'TodoItem').agent).toMatchObject({ name: 'todo', read: false })
    expect(formatGraph(g)).toContain('agent     todos (read): ADD (input), SET_FILTER (input), CLEAR_DONE (consequential)')
  })

  it('names a declaration without a name after the component (snake_case), and marks spreads as partial', () => {
    const files = write({ 'Counter.jsx': counter("Counter.agent = { actions: { ...more, SET: { description: 'Set' } } }", 'const more = {}') })
    const g = graphFiles(files, { cwd: tmp })
    expect(validateSchema(schema, g)).toEqual([])
    expect(g.components[0].agent).toEqual({ name: null, tools: 'counter', description: null, read: false, actions: [{ name: 'SET', consequential: false, input: false }], partial: true })
  })

  it("the MCP server's graph tool returns them", () => {
    write({ 'TodoApp.jsx': TODO_APP, 'TodoItem.jsx': TODO_ITEM })
    const { handle } = createMcpServer({ cwd: tmp })
    const r = handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'graph', arguments: { paths: ['.'] } } })
    const g = r.result.structuredContent
    expect(g.components.find(c => c.name === 'TodoApp').agent.actions.map(a => a.name)).toEqual(['ADD', 'SET_FILTER', 'CLEAR_DONE'])
  })
})

describe('codes', () => {
  it('registers the K-1 codes', () => {
    for (const c of ['SYG150', 'SYG151', 'SYG152', 'SYG153', 'SYG240', 'SYG243', 'SYG440', 'SYG441', 'SYG730', 'SYG731']) expect(CODES[c], c).toBeDefined()
  })
})
