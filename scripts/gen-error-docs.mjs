#!/usr/bin/env node
/**
 * Generate the docs site's error reference (docs/src/content/docs/reference/errors.md)
 * from sygnal-check/explanations.json, the single source for what every SYG
 * code means and how to fix it.
 *
 *   node scripts/gen-error-docs.mjs           # write the page
 *   node scripts/gen-error-docs.mjs --check   # exit 1 if the page is out of date
 *
 * Each code gets a heading whose anchor is the lower-cased code (`#syg101`),
 * which is what docsUrlFor() in src/extra/diagnostics/codes.ts links to.
 * The before/after examples below are the only hand-written part; the
 * title, severity, reporters, explanation and fix come from the JSON.
 * test/docs-errors.test.js fails when the committed page differs from what
 * this script renders.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const SOURCE = path.join(repo, 'sygnal-check/explanations.json')
export const TARGET = path.join(repo, 'docs/src/content/docs/reference/errors.md')

const RANGES = [
  ['1', 'Wiring: intent, model, view and EVENTS'],
  ['2', 'State and reducers'],
  ['3', 'Streams'],
  ['4', 'Collections, Switchable, sub-components and context'],
  ['5', 'Strict mode (canonical forms)'],
  ['6', 'Drivers, sources and component setup'],
  ['9', 'Internal'],
]

const REPORTERS = {
  runtime: 'the Sygnal runtime (every app, production included)',
  'dev-entry': 'the dev checks (`sygnal/diagnostics`)',
  static: '`sygnal-check`',
}

/** Hand-written before/after examples, keyed by code. */
export const EXAMPLES = {
  SYG101: {
    before: `Form.intent = ({ DOM }) => ({ SAVE: DOM.click('.save') })
Form.model  = { SUBMIT: (state) => ({ ...state, saved: true }) }`,
    after: `Form.intent = ({ DOM }) => ({ SAVE: DOM.click('.save') })
Form.model  = { SAVE: (state) => ({ ...state, saved: true }) }`,
  },
  SYG102: {
    before: `Search.intent = ({ DOM }) => ({ QUERY: DOM.input('.q').value() })
Search.model  = {
  QUERY: (state, q) => ({ ...state, q }),
  CLEAR: (state) => ({ ...state, q: '' }),   // nothing triggers CLEAR
}`,
    after: `Search.intent = ({ DOM }) => ({
  QUERY: DOM.input('.q').value(),
  CLEAR: DOM.click('.clear'),
})`,
  },
  SYG103: {
    before: `function Counter({ state }) {
  return <button className="increment">{state.count}</button>
}
Counter.intent = ({ DOM }) => ({ INC: DOM.click('.inc') })`,
    after: `Counter.intent = ({ DOM }) => ({ INC: DOM.click('.increment') })`,
  },
  SYG104: {
    before: `// Lane renders <Collection of={TaskCard} from="tasks" />; .delete is inside TaskCard
Lane.intent = ({ DOM }) => ({ DELETE_TASK: DOM.click('.delete') })`,
    after: `TaskCard.intent = ({ DOM }) => ({ DELETE: DOM.click('.delete') })
TaskCard.model  = { DELETE: { PARENT: (state) => ({ taskId: state.id }) } }

Lane.intent = ({ CHILD }) => ({
  DELETE_TASK: CHILD.select(TaskCard).map(p => p.taskId),
})`,
  },
  SYG105: {
    before: `Lane.model  = { REMOVE: { EVENTS: event('DELETE_LANE', s => ({ id: s.id })) } }
Board.intent = ({ EVENTS }) => ({ DELETE: EVENTS.select('LANE_DELETED') })`,
    after: `Board.intent = ({ EVENTS }) => ({ DELETE: EVENTS.select('DELETE_LANE') })`,
  },
  SYG106: {
    before: `<UserCard context={ctx} />        // overwritten by Sygnal's context`,
    after: `<UserCard contextValue={ctx} />`,
  },
  SYG110: {
    before: `function Todo({ state }) {
  return <button className="add-todo-btn">Add</button>
}
Todo.intent = ({ DOM }) => ({ ADD: DOM.click('.add-todo-button') })`,
    after: `Todo.intent = ({ DOM }) => ({ ADD: DOM.click('.add-todo-btn') })`,
  },
  SYG111: {
    before: `<input className="title" value={state.title} />
// intent: SAVE: DOM.blur('.title').value()`,
    after: `<input className="title" value={state.title} />
// intent: TITLE: DOM.input('.title').value()`,
  },
  SYG112: {
    before: `Quote.model = {
  LOAD:   { HTTP: (state) => ({ url: '/api/quote', ok: 'LOADED', error: 'FIALED' }) },
  LOADED: (state, quote) => ({ ...state, quote }),
  FAILED: (state, { status }) => ({ ...state, status }),
}`,
    after: `LOAD: { HTTP: (state) => ({ url: '/api/quote', ok: 'LOADED', error: 'FAILED' }) },`,
  },
  SYG115: {
    before: `Modal.intent = ({ DOM }) => ({ CLOSE: DOM.escape('document') })`,
    after: `Modal.intent = ({ DOM }) => ({
  CLOSE: DOM.keydown('document').key().filter(k => k === 'Escape'),
})`,
  },
  SYG116: {
    before: `SAVE: { EVENTS: (state) => event('SAVED', state.id) }   // returns a function`,
    after: `SAVE: { EVENTS: event('SAVED', (state) => state.id) }`,
  },
  SYG201: {
    before: `SET_NAME: (state, name) => ({ name })`,
    after: `SET_NAME: (state, name) => ({ ...state, name })`,
  },
  SYG202: {
    before: `ADD: (state, item) => { ({ ...state, items: [...state.items, item] }) }`,
    after: `ADD: (state, item) => ({ ...state, items: [...state.items, item] })`,
  },
  SYG206: {
    before: `Cart.calculated = { total: 'items' }`,
    after: `Cart.calculated = { total: [['items'], state => state.items.length] }`,
  },
  SYG207: {
    before: `Cart.initialState = { items: [], total: 0 }
Cart.calculated   = { total: state => state.items.length }`,
    after: `Cart.initialState = { items: [] }
Cart.calculated   = { total: state => state.items.length }`,
  },
  SYG208: {
    before: `Cart.calculated = { total: [['itmes'], state => state.items.length] }`,
    after: `Cart.calculated = { total: [['items'], state => state.items.length] }`,
  },
  SYG209: {
    before: `Comp.calculated = {
  a: [['b'], state => state.b + 1],
  b: [['a'], state => state.a + 1],
}`,
    after: `Comp.calculated = {
  a: [['base'], state => state.base + 1],
  b: [['a'],    state => state.a + 1],
}`,
  },
  SYG210: {
    before: `INITIALIZE: {
  STATE:  (state) => ({ ...state, ready: true }),
  EFFECT: () => analytics.track('start'),
}`,
    after: `INITIALIZE: (state) => ({ ...state, ready: true }),
BOOTSTRAP:  { EFFECT: () => analytics.track('start') },`,
  },
  SYG212: {
    before: `Comp.model = { RESET: null }`,
    after: `Comp.model = { RESET: (state) => ({ ...state, count: 0 }) }`,
  },
  SYG215: {
    before: `next('RETRY', null, '500')`,
    after: `next('RETRY', null, 500)`,
  },
  SYG217: {
    before: `NOTIFY: { LOG: (state) => { \`Saved \${state.id}\` } }`,
    after: `NOTIFY: { LOG: (state) => \`Saved \${state.id}\` }`,
  },
  SYG219: {
    before: `PLAY: { EFFECT: () => player.play() }        // returns a Promise`,
    after: `PLAY: { EFFECT: () => { player.play() } }`,
  },
  SYG220: {
    before: `Profile.calculated = { name: state => state.user.name }`,
    after: `Profile.calculated = { name: state => state.user?.name ?? '' }`,
  },
  SYG221: {
    before: `CITY: set('city')`,
    after: `CITY: set((state, city) => ({ city }))`,
  },
  SYG301: {
    before: `RESULTS: DOM.input('.q').value().pipe(debounceTime(300))`,
    after: `import { debounce } from 'sygnal'

RESULTS: DOM.input('.q').value().compose(debounce(300))`,
  },
  SYG401: {
    before: `Todos.initialState = { list: [] }
// view: <Collection of={TodoItem} from="items" />`,
    after: `Todos.initialState = { items: [] }
// view: <Collection of={TodoItem} from="items" />`,
  },
  SYG402: {
    before: `App.context = (state) => ({ theme: state.theme })`,
    after: `App.context = { theme: (state) => state.theme }`,
  },
  SYG403: {
    before: `App.context = { theme: 42 }`,
    after: `App.context = { theme: (state) => state.theme }`,
  },
  SYG405: {
    before: `Counter.initialState = { count: 0 }      // Counter is rendered by a parent`,
    after: `Counter.initialState  = { count: 0 }
Counter.isolatedState = true`,
  },
  SYG406: {
    before: `function Profile({ state }) {
  return <h1>{state.user.name}</h1>          // state.user is null at first
}`,
    after: `function Profile({ state }) {
  return <h1>{state.user?.name ?? 'Loading…'}</h1>
}
Profile.onError = (error, { componentName }) => <p>Could not render {componentName}</p>`,
  },
  SYG410: {
    before: `<UserCard state={42} />`,
    after: `<UserCard state="user" />`,
  },
  SYG411: {
    before: `<Collection of="TaskCard" from="tasks" />   // not registered in .components`,
    after: `<Collection of={TaskCard} from="tasks" />`,
  },
  SYG412: {
    before: `<Collection of={TaskCard} from={state.tasks} />`,
    after: `<Collection of={TaskCard} from="tasks" />`,
  },
  SYG414: {
    before: `// <TaskCard /> rendered, but TaskCard is neither imported nor in .components`,
    after: `import TaskCard from './TaskCard.jsx'`,
  },
  SYG415: {
    before: `<Switchable of={[ListView, GridView]} current={state.mode} />`,
    after: `<Switchable of={{ list: ListView, grid: GridView }} current={state.mode} />`,
  },
  SYG416: {
    before: `<Switchable of={{ list: ListView, grid: GridView }} current="table" />`,
    after: `<Switchable of={{ list: ListView, grid: GridView }} current="list" />`,
  },
  SYG418: {
    before: `<Collection of={Row} from="rows" sort={{ title: 'up' }} />`,
    after: `<Collection of={Row} from="rows" sort={{ title: 'desc' }} />`,
  },
  SYG420: {
    before: `import { TaskCard } from './TaskCard.jsx'   // TaskCard is a default export`,
    after: `import TaskCard from './TaskCard.jsx'`,
  },
  SYG421: {
    before: `<li className="task" data={{ 'task-id': task.id }}>{task.title}</li>`,
    after: `<li className="task" data={{ taskId: task.id }}>{task.title}</li>
// intent: DOM.click('.task').data('taskId')`,
  },
  SYG501: {
    before: `function Lane(props, state, context) {
  return <h2>{state.title}</h2>
}`,
    after: `function Lane({ state, context, ...props }) {
  return <h2>{state.title}</h2>
}`,
  },
  SYG502: {
    before: `RENAME: (state, title) => title ? { ...state, title } : state`,
    after: `import { ABORT } from 'sygnal'

RENAME: (state, title) => title ? { ...state, title } : ABORT`,
  },
  SYG503: {
    before: `PLAY: (state) => {
  playerCmd.send('play')
  return ABORT
}`,
    after: `PLAY: { EFFECT: () => playerCmd.send('play') }`,
  },
  SYG504: {
    before: `'PLAY | EFFECT': () => playerCmd.send('play')`,
    after: `PLAY: { EFFECT: () => playerCmd.send('play') }`,
  },
  SYG505: {
    before: `DELETE: emit('DELETE_LANE', (state) => ({ laneId: state.id }))
SAVE:   { EVENTS: (state) => ({ type: 'SAVED', data: state.id }) }`,
    after: `import { event } from 'sygnal'

DELETE: { EVENTS: event('DELETE_LANE', (state) => ({ laneId: state.id })) }
SAVE:   { EVENTS: event('SAVED', (state) => state.id) }`,
  },
  SYG506: {
    before: `Lane.intent = ({ CHILD }) => ({ DELETE_TASK: CHILD.select('TaskCard') })`,
    after: `import TaskCard from './TaskCard.jsx'

Lane.intent = ({ CHILD }) => ({ DELETE_TASK: CHILD.select(TaskCard) })`,
  },
  SYG507: {
    before: `// App → <Board theme={state.theme} /> → <Lane theme={theme} /> → <Card theme={theme} />`,
    after: `App.context = { theme: (state) => state.theme }
// Card: function Card({ state, context }) { … context.theme … }`,
  },
  SYG508: {
    before: `Quote.intent = ({ DOM, HTTP }) => ({
  LOAD:   DOM.click('.get'),
  LOADED: HTTP.select('quote'),
  FAILED: HTTP.errors('quote'),
})
Quote.model = {
  LOAD:   { HTTP: () => ({ category: 'quote', url: '/api/quote' }) },
  LOADED: (state, { value }) => ({ ...state, quote: value }),
  FAILED: (state, { status }) => ({ ...state, status }),
}`,
    after: `Quote.intent = ({ DOM }) => ({ LOAD: DOM.click('.get') })
Quote.model = {
  LOAD:   { HTTP: () => ({ url: '/api/quote', ok: 'LOADED', error: 'FAILED' }) },
  LOADED: (state, quote) => ({ ...state, quote }),        // the parsed body
  FAILED: (state, { status }) => ({ ...state, status }),
}`,
  },
  SYG602: {
    before: `Comp.intent = { CLICK: xs.never() }`,
    after: `Comp.intent = ({ DOM }) => ({ CLICK: DOM.click('.btn') })`,
  },
  SYG603: {
    before: `Comp.intent = ({ DOM }) => { CLICK: DOM.click('.btn') }`,
    after: `Comp.intent = ({ DOM }) => ({ CLICK: DOM.click('.btn') })`,
  },
  SYG604: {
    before: `Comp.hmrActions = 3`,
    after: `Comp.hmrActions = ['REFRESH']`,
  },
  SYG605: {
    before: `Comp.intent = ({ DOM }) => ({ 'SAVE|CLOSE': DOM.click('.save') })`,
    after: `Comp.intent = ({ DOM }) => ({ SAVE_AND_CLOSE: DOM.click('.save') })`,
  },
  SYG606: {
    before: `Cart.calculated = (state) => ({ total: state.items.length })`,
    after: `Cart.calculated = { total: (state) => state.items.length }`,
  },
  SYG608: {
    before: `// main.js, without the dev entry
run(App, {}, { diagnostics: { strict: true } })`,
    after: `import 'sygnal/diagnostics'   // dev only (the Vite plugin adds it in dev)
run(App, {}, { diagnostics: { strict: true } })`,
  },
}

function severityText(e) {
  const s = `\`${e.severity}\``
  if (e.staticSeverity && e.staticSeverity !== e.severity) return `${s} at runtime, \`${e.staticSeverity}\` in sygnal-check`
  return s
}

function reportersText(e) {
  return e.reportedBy.map(r => REPORTERS[r] || r).join(', ')
}

function entry(e) {
  const out = []
  out.push(`### ${e.code}`, '')
  out.push(`**${e.title}**`, '')
  const meta = [`Severity: ${severityText(e)}`, `Reported by: ${reportersText(e)}`]
  if (e.strict) meta.push('Strict mode only')
  out.push(meta.join(' · '), '')
  out.push(e.explanation, '')
  out.push(`**Fix:** ${e.fix}`, '')
  const ex = EXAMPLES[e.code]
  if (ex) {
    out.push('Before:', '', '```jsx', ex.before, '```', '')
    out.push('After:', '', '```jsx', ex.after, '```', '')
  }
  return out.join('\n')
}

/** Render the page from the explanations array. */
export function render(explanations) {
  const head = `---
title: Error Reference
description: Every SYG diagnostic code, what causes it, and how to fix it
---

<!-- Generated by scripts/gen-error-docs.mjs from sygnal-check/explanations.json. Do not edit by hand. -->

Every diagnostic Sygnal reports has a stable code. The runtime prints it as \`[Sygnal CODE] Component: message. Fix. Link\`:

\`\`\`text
[Sygnal SYG101] Form: Intent action 'SAVE' has no model entry, so it never does anything. Add 'SAVE' to Form.model, or remove it from Form.intent. https://sygnal.js.org/reference/errors#syg101
\`\`\`

\`sygnal-check\` prints the same code as \`file:line:col SYG101 Form: …\`. The link at the end of every message points to the entry on this page.

- **Severity**: \`error\` (something is broken; thrown or logged with \`console.error\`), \`warn\` (almost certainly a bug), \`info\` (a hint that needs a judgment call; collected but not printed).
- **Reported by**: *the Sygnal runtime* (always on, production included), *the dev checks* (the \`sygnal/diagnostics\` entry, loaded by the Vite plugin in dev and in Vitest), or *\`sygnal-check\`* (the static checker). See [Diagnostics](/guide/diagnostics/).
- **Strict mode only**: reported only with strict mode on. See [Strict Mode](/guide/strict-mode/).

From a terminal, \`npx --no-install sygnal-check explain SYG104\` prints the same entry.
`
  const groups = RANGES.map(([digit, label]) => {
    const items = explanations.filter(e => e.code.charAt(3) === digit)
    if (!items.length) return ''
    return `\n## SYG${digit}xx: ${label}\n\n` + items.map(entry).join('\n')
  })
  const known = new Set(RANGES.map(r => r[0]))
  const rest = explanations.filter(e => !known.has(e.code.charAt(3)))
  if (rest.length) groups.push(`\n## Other\n\n` + rest.map(entry).join('\n'))
  return head + groups.join('') .replace(/\n{3,}/g, '\n\n').replace(/\n*$/, '\n')
}

export function readExplanations(file = SOURCE) {
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  const page = render(readExplanations())
  if (process.argv.includes('--check')) {
    const current = fs.existsSync(TARGET) ? fs.readFileSync(TARGET, 'utf8') : ''
    if (current !== page) {
      console.error(`${path.relative(repo, TARGET)} is out of date: run node scripts/gen-error-docs.mjs`)
      process.exit(1)
    }
    console.log(`${path.relative(repo, TARGET)} is up to date`)
  } else {
    fs.writeFileSync(TARGET, page)
    console.log(`wrote ${path.relative(repo, TARGET)} (${readExplanations().length} codes)`)
  }
}
