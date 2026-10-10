// PLAN-6 2-W (A-2, D267, G-599): experimentalExposeWebMcp in a real browser, on its own page
// (webmcp.html: the polyfill can't be uninstalled). run-headless.mjs opens it after the main
// suite with ?mode=
//   native   — Chromium launched with --enable-features=WebMCP (Chrome 153's document.modelContext)
//   polyfill — @mcp-b/webmcp-polyfill (a second Chromium launch without the switch, Firefox, WebKit)
//   none     — no WebMCP: the call is a no-op
// The test acts as the agent through getTools / executeTool (./agent.js normalizes the two
// implementations, G-600); the confirmation dialog gets real input (window.__pwWebMcp).
import { run, Collection, onDiagnostic, form } from 'sygnal'
import { experimentalExposeWebMcp, jsonSchema, formTool } from 'sygnal/ai'
import { agentClient, isNative } from './agent.js'

const mode = new URLSearchParams(location.search).get('mode') || 'polyfill'
const results = []
const out = document.getElementById('out')
const settle = (ms = 30) => new Promise((r) => setTimeout(r, ms))
async function step(name, fn) {
  // G-624: the runner's per-test console allowlist (run-headless.mjs) knows which step runs
  await window.__pwTest?.(name)
  try {
    const detail = await Promise.race([fn(), new Promise((_, j) => setTimeout(() => j(new Error('timeout (4 s)')), 4000))])
    results.push({ name, pass: true, detail: detail === undefined ? '' : JSON.stringify(detail) })
  } catch (e) {
    results.push({ name, pass: false, detail: `${e.name}: ${e.message}` })
  } finally {
    await window.__pwTest?.(null)
  }
  out.textContent = results.map((r) => `${r.pass ? 'PASS' : 'FAIL'} ${r.name} ${r.detail}`).join('\n')
}
const assert = (c, m) => { if (!c) throw new Error(m) }
const eq = (a, b, m) => assert(JSON.stringify(a) === JSON.stringify(b), `${m}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`)

// ---------------------------------------------------------------- the app (samples §3)
function TodoApp({ state }) {
  return (
    <main>
      <ul className="todos"><Collection of={TodoItem} from="todos" /></ul>
      <button type="button" className="clear" disabled={!state.todos.some((t) => t.done)}>Clear done</button>
      {state.showStats ? <Stats state="stats" /> : null}
    </main>
  )
}
TodoApp.initialState = { todos: [{ id: 1, text: 'buy milk', done: false }, { id: 2, text: 'walk dog', done: true }], filter: 'all', nextId: 3, showStats: false, stats: { views: 0 } }
TodoApp.intent = ({ DOM }) => ({ CLEAR_DONE: DOM.click('.clear') })
TodoApp.model = {
  ADD: (state, text) => ({ ...state, todos: [...state.todos, { id: state.nextId, text, done: false }], nextId: state.nextId + 1 }),
  SET_FILTER: (state, filter) => (filter === state.filter ? state : { ...state, filter }),
  CLEAR_DONE: (state) => ({ ...state, todos: state.todos.filter((t) => !t.done) }),
  SHOW_STATS: (state, showStats) => ({ ...state, showStats }),
}
// JSON Schema inputs through jsonSchema() (no schema library in browser-tests)
TodoApp.agent = {
  name: 'todos',
  description: 'the todo list',
  untrusted: true,
  read: (state) => ({ todos: state.todos.map(({ id, text, done }) => ({ id, text, done })), filter: state.filter }),
  actions: {
    ADD: { description: 'Add a todo', input: jsonSchema({ type: 'string', minLength: 1, description: 'The todo text' }) },
    SET_FILTER: { description: 'Which todos to show', input: jsonSchema({ type: 'string', enum: ['all', 'active', 'done'] }) },
    CLEAR_DONE: { description: 'Delete every todo that is done', consequential: true, when: (state) => state.todos.some((t) => t.done) },
    SHOW_STATS: { description: 'Show or hide the statistics panel', input: jsonSchema({ type: 'boolean' }) },
  },
}

function TodoItem({ state }) {
  return (
    <li data-id={state.id}>
      <label><input type="checkbox" className="done" checked={state.done} /> {state.text}</label>
    </li>
  )
}
TodoItem.intent = ({ DOM }) => ({ TOGGLE: DOM.change('.done') })
TodoItem.model = { TOGGLE: (state) => ({ ...state, done: !state.done }), REMOVE: () => undefined }
TodoItem.agent = {
  name: 'todo',
  description: 'a todo',
  label: (state) => state.text,
  actions: {
    TOGGLE: { description: 'Mark the todo done, or not done again' },
    REMOVE: { description: 'Delete the todo', consequential: true },
  },
}

function Stats({ state }) { return <p className="stats">views: {state.views}</p> }
Stats.model = { COUNT_ONE_MORE_VIEW_OF_THE_PANEL: (s) => ({ ...s, views: s.views + 1 }) }
Stats.agent = { name: 'statistics_panel', description: 'the statistics panel', read: (s) => s, actions: { COUNT_ONE_MORE_VIEW_OF_THE_PANEL: { description: 'Count a view. ' + 'Views are counted once per visit. '.repeat(20) } } }

// ---------------------------------------------------------------- A-3: form(…, { tool: formTool() })
// a hand-written Standard Schema: the email must have an '@' (the field is type=text, so the
// browser's constraint validation lets 'nope' through and the schema answers), a plan
const signupSchema = {
  '~standard': {
    version: 1, vendor: 'test',
    validate(v) {
      const issues = []
      if (!/^[^\s@]+@[^\s@]+$/.test(v.email)) issues.push({ message: 'Enter an email address', path: ['email'] })
      if (!['free', 'pro'].includes(v.plan)) issues.push({ message: 'Pick a plan', path: ['plan'] })
      return issues.length ? { issues } : { value: { email: v.email.trim().toLowerCase(), plan: v.plan } }
    },
  },
}
const signup = (cls) => function Signup({ state }) {
  const f = state.form.values
  return (
    <section className={cls}>
      <form className="signup">
        <label>Email address <input type="text" name="email" value={f.email} /></label>
        <select name="plan" aria-label="The plan to sign up for" value={f.plan}>
          <option value="">-</option><option value="free">Free</option><option value="pro">Pro</option>
        </select>
        <button type="submit">Sign up {cls}</button>
      </form>
      <p className="saved">{state.saved ? `saved:${state.saved.email}:${state.saved.plan}:${state.saved.by}` : 'none'}</p>
    </section>
  )
}
const SignupAuto = signup('auto'), SignupConfirm = signup('confirm')
for (const [C, name, autosubmit] of [[SignupAuto, 'sign_up_auto', true], [SignupConfirm, 'sign_up_confirm', false]]) {
  C.uses = { form: form(signupSchema, { values: { email: '', plan: '' }, submit: 'SAVE', show: 'submit', tool: formTool({ name, description: `Create an account (${name})`, autosubmit }) }) }
  C.model = { SAVE: (s, v) => ({ ...s, saved: { ...v, by: s.submits + 1 }, submits: s.submits + 1 }) }
}
function Forms() { return <div><SignupAuto state="a" /><SignupConfirm state="c" /></div> }
Forms.initialState = { a: { saved: null, submits: 0 }, c: { saved: null, submits: 0 } }

async function formChecks(agent, mc) {
  const app = run(Forms, {}, { mountPoint: '#root3' })
  await app.__runtime.flushed()
  const q = (s) => document.querySelector(`#root3 ${s}`)
  const saved = (cls) => q(`.${cls} .saved`).textContent
  await step('A-3: form(…, { tool: formTool() }) writes the attributes (not props) and registers both form tools', async () => {
    const f = q('.auto form')
    eq([f.getAttribute('toolname'), f.getAttribute('tooldescription'), f.hasAttribute('toolautosubmit')], ['sign_up_auto', 'Create an account (sign_up_auto)', true], 'auto form')
    eq(q('.confirm form').hasAttribute('toolautosubmit'), false, 'confirm form')
    eq(q('.auto [name="email"]').getAttribute('toolparamdescription'), 'Email address', 'label')
    eq(q('.auto [name="plan"]').getAttribute('toolparamdescription'), 'The plan to sign up for', 'aria-label (G-603)')
    const ts = await agent.until((ts) => ['sign_up_auto', 'sign_up_confirm'].every((n) => ts.some((t) => t.name === n)))
    const s = ts.find((t) => t.name === 'sign_up_auto').inputSchema
    eq(Object.keys(s.properties).sort(), ['email', 'plan'], 'params')
    eq(s.properties.email.description, 'Email address', 'email description')
    eq(s.properties.plan.description, 'The plan to sign up for', 'plan description')
    return s.properties.plan
  })
  await step('A-3: an agent submit (autosubmit) that is valid: { ok: true, values }, the DOM rendered', async () => {
    const r = await agent.call('sign_up_auto', { email: 'A@B.co', plan: 'pro' })
    eq(r, { ok: true, values: { email: 'a@b.co', plan: 'pro' } }, 'answer')
    eq(saved('auto'), 'saved:a@b.co:pro:1', 'DOM when the answer came')
  })
  await step('A-3: an agent submit (autosubmit) that the schema refuses: { ok: false, errors }, nothing saved', async () => {
    const r = await agent.call('sign_up_auto', { email: 'nope', plan: 'free' })
    eq(r, { ok: false, errors: { email: 'Enter an email address' } }, 'answer')
    eq(saved('auto'), 'saved:a@b.co:pro:1', 'not saved again')
  })
  await step('A-3: autosubmit off: the call fills the form and waits for the user\'s submit (real click)', async () => {
    let settled = false
    const p = agent.call('sign_up_confirm', { email: 'c@d.ef', plan: 'free' }).then((x) => { settled = true; return x }, (e) => { settled = true; return `${e.name}: ${e.message}` })
    for (let i = 0; i < 100 && q('.confirm [name="email"]').value !== 'c@d.ef'; i++) await settle(10)
    eq(q('.confirm [name="email"]').value, 'c@d.ef', 'filled')
    await settle(150)
    eq([settled, saved('confirm')], [false, 'none'], 'pending, nothing saved')
    await window.__pwWebMcp('click', 'Sign up confirm')
    eq(await p, { ok: true, values: { email: 'c@d.ef', plan: 'free' } }, 'answer after the user submitted')
    eq(saved('confirm'), 'saved:c@d.ef:free:1', 'DOM')
  })
  await step('A-3: a user\'s own submit is unchanged (no agent call pending)', async () => {
    await window.__pwWebMcp('click', 'Sign up confirm')
    for (let i = 0; i < 100 && saved('confirm') !== 'saved:c@d.ef:free:2'; i++) await settle(10)
    eq(saved('confirm'), 'saved:c@d.ef:free:2', 'saved by the user')
  })
  await step('A-3: removing the form unregisters its tool', async () => {
    app.dispose()
    await agent.until((ts) => !ts.some((t) => t.name.startsWith('sign_up')))
  })
}

// ---------------------------------------------------------------- the round trip
async function main() {
  const env = { mode, secure: isSecureContext }
  if (mode === 'polyfill') {
    const { installWebMCP } = await import('@mcp-b/webmcp-polyfill')
    installWebMCP()
  }
  const mc = document.modelContext
  env.native = mc ? isNative(mc) : null
  results.push({ name: 'env', pass: true, detail: JSON.stringify(env) })

  const app = run(TodoApp, {}, { mountPoint: '#root', diagnostics: 'warn' })
  await app.__runtime.flushed()

  if (mode === 'none' || !mc) {
    await step('no WebMCP: experimentalExposeWebMcp is a no-op', async () => {
      assert(!mc, `modelContext in mode ${mode}`)
      const stop = experimentalExposeWebMcp(app)
      eq(stop.available, false, 'available')
      stop()
      app.dispose()
    })
    return finish()
  }
  await step(`the ${mode} implementation is in use`, async () => eq(isNative(mc), mode === 'native', 'native'))

  const diagnostics = []
  const offDiag = onDiagnostic((d) => diagnostics.push(`${d.code} ${d.message}`))
  const stop = experimentalExposeWebMcp(app)
  const agent = agentClient(mc)
  let toolchanges = 0
  mc.addEventListener('toolchange', () => toolchanges++)
  const names = () => agent.names(/^(todos?|statistics)_/)
  const lis = () => [...document.querySelectorAll('#root li')].map((li) => `${li.dataset.id}:${li.querySelector('.done').checked ? 'x' : ' '}:${li.textContent.trim()}`)
  const dialog = async () => { for (let i = 0; i < 100; i++) { const d = document.querySelector('dialog[data-sygnal-webmcp]'); if (d) return d; await settle(10) } throw new Error('no dialog') }

  await step('list tools', async () => {
    eq(await names(), ['todo_remove', 'todo_toggle', 'todos_add', 'todos_clear_done', 'todos_read', 'todos_set_filter', 'todos_show_stats'], 'tools')
  })
  await step('schemas, descriptions and annotations, as the agent sees them', async () => {
    const ts = Object.fromEntries((await agent.list()).map((t) => [t.name, t]))
    eq(ts.todo_toggle.inputSchema.properties.id.enum, [1, 2], 'todo_toggle id enum')
    eq(ts.todos_add.inputSchema, { type: 'object', properties: { value: { type: 'string', minLength: 1, description: 'The todo text' } }, required: ['value'], additionalProperties: false }, 'todos_add schema')
    // D286 / G-650: an untrusted projection has no summary in the descriptions (no user text); the
    // item tools say which read tool to call first, and their ids carry no labels
    eq(ts.todos_add.description, 'Add a todo', 'todos_add description')
    eq(ts.todo_toggle.description, "Mark the todo done, or not done again. Call todos_read first to find the todo's id.", 'todo_toggle description')
    eq(ts.todo_toggle.inputSchema.properties.id.description, 'Which todo (ids 1, 2; todos_read has their contents)', 'todo_toggle id')
    eq(ts.todos_read.annotations, { readOnlyHint: true, untrustedContentHint: true }, 'todos_read')
    eq(ts.todos_add.annotations, { readOnlyHint: false, untrustedContentHint: true }, 'todos_add')
    return { todo_remove: (await mc.getTools()).find((t) => t.name === 'todo_remove').annotations }
  })
  await step('todos_read', async () => {
    const r = await agent.call('todos_read')
    eq(r, { ok: true, state: { todos: [{ id: 1, text: 'buy milk', done: false }, { id: 2, text: 'walk dog', done: true }], filter: 'all' } }, 'read')
  })
  await step('todos_add updates the state, the DOM and the item tool enum', async () => {
    const r = await agent.call('todos_add', { value: 'call mom' })
    assert(r.ok === true, JSON.stringify(r))
    eq(r.state.todos.map((t) => t.text), ['buy milk', 'walk dog', 'call mom'], 'state')
    eq(lis(), ['1: :buy milk', '2:x:walk dog', '3: :call mom'], 'DOM')
    const ts = await agent.until((ts) => JSON.stringify(ts.find((t) => t.name === 'todo_toggle')?.inputSchema.properties.id.enum) === '[1,2,3]')
    assert(!ts.some((t) => /call mom/.test(t.description + JSON.stringify(t.inputSchema))), 'no user text in the tool list')
  })
  await step('todo_toggle (a Collection item tool) checks the item in the DOM', async () => {
    const r = await agent.call('todo_toggle', { id: 3 })
    assert(r.ok === true, JSON.stringify(r))
    eq(lis()[2], '3:x:call mom', 'DOM')
  })
  await step('an unknown id lists the live ids', async () => {
    const r = await agent.call('todo_toggle', { id: 7 })
    eq(r, { ok: false, error: 'no todo with id 7; ids: 1 (buy milk), 2 (walk dog), 3 (call mom)', keys: [1, 2, 3] }, 'error')
  })
  await step('invalid input is refused before dispatch', async () => {
    const r1 = await agent.call('todos_add', { value: 42 })
    const r2 = await agent.call('todos_add', { value: '' })
    assert(r1.ok === false && r2.ok === false, JSON.stringify([r1, r2]))
    eq(lis().length, 3, 'no new item')
    return [r1.error, r2.error]
  })
  await step('a no-op is reported', async () => {
    const r = await agent.call('todos_set_filter', { value: 'all' })
    assert(r.ok === false && /changed nothing/.test(r.error), JSON.stringify(r))
  })
  await step('consequential, default dialog: Escape (real key) declines', async () => {
    const p = agent.call('todo_remove', { id: 1 })
    const d = await dialog()
    assert(d.parentNode === document.body && !document.getElementById('root').contains(d), 'outside the app')
    assert(d.matches(':modal'), 'modal')
    eq(document.getElementById(d.getAttribute('aria-labelledby'))?.textContent, 'Allow the AI agent to do this?', 'label')
    eq(document.getElementById(d.getAttribute('aria-describedby'))?.textContent, 'Delete the todo (buy milk)', 'description')
    eq(document.activeElement?.textContent, 'Deny', 'focus')
    await window.__pwWebMcp('press', 'Escape')
    eq(await p, { ok: false, error: 'the user declined' }, 'declined')
    eq(lis().length, 3, 'still 3')
    assert(!document.querySelector('dialog'), 'dialog removed')
  })
  await step('consequential, default dialog: Allow (real click) runs it', async () => {
    const p = agent.call('todo_remove', { id: 1 })
    await dialog()
    await window.__pwWebMcp('click', 'Allow')
    const r = await p
    assert(r.ok === true, JSON.stringify(r))
    eq(lis().map((s) => s.split(':')[0]), ['2', '3'], 'DOM after remove')
    await agent.until((ts) => JSON.stringify(ts.find((t) => t.name === 'todo_toggle')?.inputSchema.properties.id.enum) === '[2,3]')
  })
  await step('`when`: todos_clear_done is offered only while a todo is done', async () => {
    const p = agent.call('todos_clear_done')
    await dialog()
    await window.__pwWebMcp('click', 'Allow')
    const r = await p
    assert(r.ok === true, JSON.stringify(r))
    eq(lis(), [], 'every todo was done')
    const ts = await agent.until((ts) => !ts.some((t) => t.name === 'todos_clear_done' || t.name === 'todo_toggle'))
    return ts.map((t) => t.name).filter((n) => n.startsWith('todo'))
  })
  await step('a child mounted later registers its tools (within the budgets); unmounting unregisters them', async () => {
    eq((await agent.call('todos_show_stats', { value: true })).ok, true, 'show')
    const ts = await agent.until((ts) => ts.some((t) => t.name.startsWith('statistics_panel_count')))
    const count = ts.find((t) => t.name.startsWith('statistics_panel_count'))
    assert(count.name.length === 30 && /^statistics_panel_count_on_[0-9a-z]{4}$/.test(count.name), count.name)
    for (const t of ts) assert(t.name.length <= 30 && t.description.length <= 500, `${t.name}: ${t.description.length}`)
    const r = await agent.call(count.name)
    eq(r, { ok: true, state: { views: 1 } }, 'count')
    eq(document.querySelector('#root .stats').textContent, 'views: 1', 'DOM')
    eq((await agent.call('todos_show_stats', { value: false })).ok, true, 'hide')
    await agent.until((ts) => !ts.some((t) => t.name.startsWith('statistics')))
    return count.name
  })
  await step('toolchange fired; registerTool never rejected (SYG676)', async () => {
    assert(toolchanges > 0, 'no toolchange')
    eq(diagnostics.filter((d) => /SYG676/.test(d)), [], 'SYG676')
    return { toolchanges, diagnostics: diagnostics.map((d) => d.slice(0, 6)) }
  })
  await step('app.dispose() unregisters every tool; stop() after it is harmless', async () => {
    app.dispose()
    await agent.until((ts) => !ts.some((t) => /^(todos?|statistics)_/.test(t.name)))
    stop()
    eq(await names(), [], 'tools after dispose')
  })
  await step('stop() unregisters every tool of a running app', async () => {
    const app2 = run(TodoApp, {}, { mountPoint: '#root2' })
    await app2.__runtime.flushed()
    const stop2 = experimentalExposeWebMcp(app2, { confirm: false, prefix: 'two_' })
    eq((await agent.names(/^two_/)).length, 7, 'registered')
    eq(await agent.call('two_todo_remove', { id: 1 }), { ok: false, error: 'the user declined' }, 'confirm: false')
    stop2()
    await agent.until((ts) => !ts.some((t) => t.name.startsWith('two_')))
    app2.dispose()
  })
  await formChecks(agent, mc)
  offDiag()
  finish()
}
function finish() { window.__results = results; window.__done = true }
main().catch((e) => { results.push({ name: 'main', pass: false, detail: e.stack }); finish() })
