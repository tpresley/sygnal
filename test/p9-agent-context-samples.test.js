// @vitest-environment jsdom
// PLAN-9 D-3 (D461): the composed-UI and chat-card lines of llms.txt and the sygnal-dev skill run
// (as PLAN-6 4-L's p6-4l-agent-ai-samples does for the chat lines). Each FRAGMENTS entry is the
// exact text of the file(s) it names (checked first); it is placed in a small module (fixtures
// around it, the fragment unchanged), compiled with the automatic JSX runtime, imported against
// the built package (dist: `npm run build` first) and run with the driver fakes. Every module is
// also checked with `sygnal-check --strict`. The skill's own code blocks run as they are. No network.
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import ts from 'typescript'
import 'sygnal/diagnostics'
import { renderComponent, byId } from 'sygnal'
import { compose, composeWith, defineCatalog } from 'sygnal/ai'
import { checkFiles } from '../sygnal-check/src/index.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const repo = path.resolve(here, '..')
const FILES = {
  llms: fs.readFileSync(path.join(repo, 'llms.txt'), 'utf8'),
  skill: fs.readFileSync(path.join(repo, 'skills/sygnal-dev/SKILL.md'), 'utf8'),
}

// text → the files that contain it verbatim
const FRAGMENTS = {
  catalog: [['llms'], `const catalog = defineCatalog({ parts: { revenue: { component: Kpi, props: { metric: 'revenue' }, description: 'Revenue (KPI card: the total this month)' }, orders: { component: OrdersTable, description: 'Orders (table of recent orders)', params: { status: { default: 'any', options: { any: 'orders of every status', pending: 'pending orders (not paid yet)' } } } }, tasks: { component: Checklist, state: 'tasks', description: "Tasks (the user's checklist)" } } })`],
  uses: [['llms'], "Dashboard.uses = { page: compose(catalog, { backend: compose.decisions({ model: 'jev-latest' }), form: '.ask', prompt: '.prompt' }) }"],
  render: [['llms', 'skill'], '{catalog.render(state.page, state)}'],
  composed: [['llms'], '<Composed catalog={catalog} from="page" />'],
  record: [['llms', 'skill'], "(node) => byId('customers', node.params.id)"],
  followUp: [['llms', 'skill'], "next('page.COMPOSE', 'Move the orders to the top')"],
  agentAction: [['llms', 'skill'], "actions: { ...compose.action('page') }"],
  agentRead: [['llms'], "read: (s) => ({ page: compose.summary(s.page) })"],
  composeTest: [['llms'], "t.simulateAction('page.COMPOSE', 'Pending orders')"],
  composeWith: [['llms'], "await composeWith(t, catalog, [{ part: 'orders', params: { status: 'pending' } }])"],
  askUses: [['llms'], "uses = { assistant: chat({ form: '.ask', prompt: '.prompt', ask: { catalog } }) }"],
  askBackend: [['llms'], "ask: { catalog, backend: compose.decisions({ model: 'jev-latest' }) }"],
  askCard: [['llms'], 'askCard(catalog, state, part) ?? <p>Composing…</p>'],
  answer: [['llms', 'skill'], 'PICK: { PARENT: (state, id, next, props) => compose.answer(props, id) }'],
  clientTools: [['llms', 'skill'], "clientTools: { confirm: { description, inputSchema } }"],
  toolOutput: [['llms', 'skill'], "next('assistant.TOOL_OUTPUT', { toolCallId, output })"],
  openToolCalls: [['llms', 'skill'], 'openToolCalls(state.assistant)'],
  chatModel: [['llms'], 'chat({ model: (state) => state.chatModel })'],
  askStream: [['llms', 'skill'], "await t.stream('LLM', [{ toolCall: { id: 'c1', name: 'ask_user', input: { need: 'Pick a plan' } } }])"],
  askComposeWith: [['llms', 'skill'], "await composeWith(t, catalog, [{ part: 'plans' }])"],
  guides: [['llms', 'skill'], '`ai-compose.md`'],
  guidesCards: [['llms', 'skill'], '`ai-cards.md`'],
}
const F = Object.fromEntries(Object.entries(FRAGMENTS).map(([k, [, text]]) => [k, text]))
const evaluateAsync = (fragment, bindings) => new Function(...Object.keys(bindings), 'return (async () => { ' + fragment + ' })()')(...Object.values(bindings))

let dir
let n = 0
const compile = (src, file) => ts.transpileModule(src, { fileName: file, compilerOptions: {
  jsx: ts.JsxEmit.ReactJSX, jsxImportSource: 'sygnal', module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, allowJs: true,
} }).outputText

// several modules in one folder (relative imports between them), the entry imported
async function loadAll(modules, entry) {
  const folder = path.join(dir, 'm' + (n++))
  fs.mkdirSync(folder, { recursive: true })
  for (const [name, src] of Object.entries(modules)) fs.writeFileSync(path.join(folder, name + '.jsx'), compile(src, name + '.jsx'))
  return import(pathToFileURL(path.join(folder, entry + '.jsx')).href)
}

function check(name, code) {
  const file = path.join(dir, 'check', name + '.jsx')
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, code)
  return checkFiles([file], { cwd: path.dirname(file), strict: true }).map((d) => `${d.code} ${d.message}`)
}

beforeAll(() => { dir = fs.mkdtempSync(path.join(here, '.p9-agentctx-samples-')) })
afterAll(() => { if (dir) fs.rmSync(dir, { recursive: true, force: true }) })

let t
afterEach(() => { try { t?.dispose() } catch (_) {} t = null })

// ── the modules: fixtures around the fragments ──────────────────────────────

const PARTS = `export function Kpi({ metric }) {
  return <section className="kpi"><h3>{metric}</h3></section>
}
export function OrdersTable({ status }) {
  return <section className="orders"><h3>Orders: {status}</h3></section>
}
export function Checklist({ state }) {
  return (
    <ul className="tasks">
      {state.map((task) => <li><label><input type="checkbox" className="toggle" checked={task.done} data={{ id: task.id }} /> {task.text}</label></li>)}
    </ul>
  )
}
Checklist.intent = ({ DOM }) => ({ TOGGLE: DOM.change('.toggle').data('id', Number) })
Checklist.model = { TOGGLE: (tasks, id) => tasks.map((task) => (task.id === id ? { ...task, done: !task.done } : task)) }
`

const dashboard = (view) => `import { defineCatalog, compose, Composed } from 'sygnal/ai'
import { Kpi, OrdersTable, Checklist } from './parts.jsx'

export ${F.catalog}

export function Dashboard({ state }) {
  return (
    <main>
      <form className="ask">
        <input className="prompt" aria-label="The page you want" value={state.page.prompt} />
        <button type="submit">Compose</button>
      </form>
      <button type="button" className="top">Orders first</button>
      <div className="canvas">${view}</div>
    </main>
  )
}
Dashboard.initialState = { tasks: [{ id: 1, text: 'Reply to Globex', done: false }] }
${F.uses}
Dashboard.intent = ({ DOM }) => ({ TOP: DOM.click('.top') })
Dashboard.model = { TOP: { EFFECT: (state, data, next) => ${F.followUp} } }
Dashboard.agent = {
  name: 'app',
  description: 'The dashboard',
  ${F.agentRead},
  ${F.agentAction},
}
`

const CARDS = `import { defineCatalog, compose } from 'sygnal/ai'

export function PlanPicker({ state, answer, frozen }) {
  return (
    <ul className="plans">
      {state.plans.map((p) => <li><button type="button" className={p.id === answer ? 'plan picked' : 'plan'} data={{ id: p.id }} disabled={frozen}>{p.name}</button></li>)}
    </ul>
  )
}
PlanPicker.intent = ({ DOM }) => ({ PICK: DOM.click('.plan').data('id') })
PlanPicker.model = { ${F.answer} }

export const catalog = defineCatalog({
  parts: { plans: { component: PlanPicker, result: true, description: 'The pricing plans to pick from (Free, Team)' } },
})
`

const planChat = (uses) => `import { chat, askCard, compose } from 'sygnal/ai'
import { catalog } from './cards.jsx'

function messagePart(part, state) {
  if (part.type === 'text') return <p>{part.text}</p>
  if (part.type !== 'tool-ask_user') return null
  return <section className="ask-card">{${F.askCard}}</section>
}

export function PlanChat({ state }) {
  const a = state.assistant
  return (
    <div>
      <ol>{a.messages.map((m) => <li className={m.role}>{m.parts.map((part) => messagePart(part, state))}</li>)}</ol>
      <form className="ask">
        <input className="prompt" aria-label="Message" value={a.prompt} />
        <button type="submit">Send</button>
      </form>
    </div>
  )
}
PlanChat.initialState = { plans: [{ id: 'free', name: 'Free' }, { id: 'team', name: 'Team' }], chatModel: 'qwen3:8b' }
PlanChat.${uses}
`

const MODULES = {
  parts: PARTS,
  dashboardRender: dashboard(F.render),
  dashboardComposed: dashboard(F.composed),
  cards: CARDS,
  planChat: planChat(F.askUses),
}

// ── the fragments are in the files ──────────────────────────────────────────

describe('every fragment is in its agent doc, verbatim', () => {
  for (const [name, [files, text]] of Object.entries(FRAGMENTS)) {
    for (const file of files) it(`${name} (${file})`, () => { expect(FILES[file]).toContain(text) })
  }
  it('the guides they name are shipped in dist/guide', () => {
    for (const g of ['ai-compose', 'ai-cards']) expect(fs.existsSync(path.join(repo, 'dist/guide', g + '.md')), g).toBe(true)
  })
})

// ── static: strict-clean and a11y-clean ─────────────────────────────────────

describe('sygnal-check --strict: no findings', () => {
  for (const [name, code] of Object.entries(MODULES)) {
    it(name, () => { expect(check(name, code)).toEqual([]) })
  }
})

// ── runtime ─────────────────────────────────────────────────────────────────

const BACKENDS = [['decisions', null], ['llm', "compose.llm()"]]
const withBackend = (src, llm) => (llm ? src.replace("compose.decisions({ model: 'jev-latest' })", llm) : src)

describe('catalog + compose (llms.txt)', () => {
  for (const [view, mod] of [['catalog.render', 'dashboardRender'], ['<Composed>', 'dashboardComposed']]) {
    for (const [backend, llm] of BACKENDS) {
      it(`${view}, compose.${backend}(): the test lines compose the pending orders; the follow-up edits the page`, async () => {
        const { Dashboard, catalog } = await loadAll({ parts: PARTS, dashboard: withBackend(MODULES[mod], llm) }, 'dashboard')
        t = renderComponent(Dashboard, { strict: true })
        await evaluateAsync(F.composeTest + '; ' + F.composeWith, { t, catalog, composeWith })
        await t.waitForState((s) => s.page.status === 'done')
        expect(t.state.page.layout.nodes.orders.params).toEqual({ status: 'pending' })
        expect(t.html()).toContain('Orders: pending')

        t.simulateAction('page.COMPOSE', 'My tasks too')
        await composeWith(t, catalog, [{ part: 'orders', params: { status: 'pending' } }, { part: 'tasks' }])
        await t.waitForState((s) => s.page.status === 'done' && !!s.page.layout.nodes.tasks)
        expect(t.query('.tasks')).toBeTruthy()

        t.simulateEvent('.top', 'click')
        await t.waitForState((s) => s.page.status !== 'done')
        await composeWith(t, catalog, [{ part: 'orders', params: { status: 'pending' } }, { part: 'tasks' }])
        await t.waitForState((s) => s.page.status === 'done')
        expect(Object.keys(t.state.page.layout.nodes).sort()).toEqual(['orders', 'page', 'tasks'])
        t.expectNoDiagnostics()
      })
    }
  }

  it('the agent read and action: compose.summary and the page_compose tool', async () => {
    const { Dashboard } = await loadAll({ parts: PARTS, dashboard: MODULES.dashboardRender }, 'dashboard')
    t = renderComponent(Dashboard, { strict: true })
    expect(t.tools().map((tool) => tool.name)).toContain('app_page_compose')
    expect(t.agentContext()).toBeTruthy()
  })

  it("a record part: state: (node) => byId('customers', node.params.id)", async () => {
    const lens = new Function('byId', 'return ' + F.record)(byId)
    const state = { customers: [{ id: 7, name: 'Northwind' }, { id: 8, name: 'Globex' }] }
    const l = lens({ part: 'customer', params: { id: 8 } })
    expect(l.get(state)).toEqual({ id: 8, name: 'Globex' })
    expect(l.set(state, { id: 8, name: 'Globex Inc' }).customers[1].name).toBe('Globex Inc')
    const catalog = defineCatalog({ parts: { customer: {
      component: () => null, description: 'Customer (card: one customer)', maxUses: 4,
      params: { id: { from: (s) => s.customers.map((c) => ({ value: c.id, name: c.name })) } },
      state: lens,
    } } })
    expect(catalog.records('customer', state).map((r) => r.value)).toEqual([7, 8])
  })
})

describe('chat({ ask }) cards (llms.txt)', () => {
  for (const [backend, uses] of [['llm', F.askUses], ['decisions', F.askUses.replace('ask: { catalog }', F.askBackend)]]) {
    it(`compose.${backend}(): the test lines open a card; the pick answers the call with { part, answer }`, async () => {
      const { PlanChat } = await loadAll({ cards: CARDS, planChat: planChat(uses) }, 'planChat')
      const { catalog } = await import(pathToFileURL(path.join(dir, 'm' + (n - 1), 'cards.jsx')).href)
      t = renderComponent(PlanChat, { strict: true })
      t.simulateAction('assistant.SEND', 'Which plan should I take?')
      await t.next((s) => s.assistant.status === 'submitted')
      await evaluateAsync(F.askStream + '; ' + F.askComposeWith, { t, catalog, composeWith })
      await t.waitForState((s) => s.assistant.status === 'ready')
      expect(t.query('.plan')).toBeTruthy()
      t.simulateEvent('.plan[data-id="team"]', 'click')
      await t.waitForState((s) => s.assistant.status === 'submitted')
      const call = t.requests('LLM').at(-1).messages.at(-1).parts.find((p) => p.type === 'tool-ask_user')
      expect(call.output).toEqual({ part: 'plans', answer: 'team' })
    })
  }

  it("chat({ model: (state) => state.chatModel }) resolves the model per request", async () => {
    const uses = "uses = { assistant: " + F.chatModel.replace('chat({ ', "chat({ form: '.ask', prompt: '.prompt', ") + ' }'
    const { PlanChat } = await loadAll({ cards: CARDS, planChat: planChat(uses) }, 'planChat')
    t = renderComponent(PlanChat, { strict: true })
    t.simulateAction('assistant.SEND', 'Hi')
    await t.next((s) => s.assistant.status === 'submitted')
    expect(t.requests('LLM').at(-1).model).toBe('qwen3:8b')
  })
})

// ── the skill's code blocks run as they are ─────────────────────────────────

describe('the skill: composed UI section', () => {
  const section = FILES.skill.split('### Composed UI and chat cards (`sygnal/ai`)')[1]?.split('\n### ')[0] ?? ''
  const blocks = [...section.matchAll(/```(\w+)\n([\s\S]*?)```/g)].map((m) => m[2])

  it('has the Dashboard module and its test', () => {
    expect(blocks).toHaveLength(2)
    expect(check('skillDashboard', blocks[0])).toEqual([])
  })

  it('the test block passes against the Dashboard block (parts.jsx a fixture)', async () => {
    const skillParts = PARTS.replace(/export function Kpi[\s\S]*?\n}\n/, '')
    const { Dashboard, catalog } = await loadAll({ parts: skillParts, Dashboard: blocks[0] }, 'Dashboard')
    const body = blocks[1].split("it('composes the pending orders', async () => {")[1].replace(/\}\)\s*$/, '')
    await evaluateAsync(body, { renderComponent, composeWith, catalog, Dashboard, expect })
  })
})
