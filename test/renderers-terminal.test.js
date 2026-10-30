// sygnal/terminal: examples/todomvc unchanged (views, intents, models, Collection, Transition,
// refs, autoFocus, processForm) in a terminal; the painter; raw keys; runTerminal on fake streams.
import { describe, it, expect, afterEach } from 'vitest'
import { EventEmitter } from 'node:events'
import { run, createElement as h, controls, xs } from 'sygnal'
import { createTerminal, runTerminal, parseKeys, paint } from 'sygnal/terminal'
import { HostDocument, makeHostDriver } from 'sygnal/host'
import { APP } from './copied/todomvc-app.js'

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms))
const apps = []
afterEach(() => apps.splice(0).forEach((a) => a.dispose()))

/** todomvc's two app drivers, in memory, with the same source shapes */
export function memoryStore(seed = {}) {
  const data = new Map(Object.entries(seed))
  return {
    data,
    driver: (fx$) => {
      fx$.addListener({ next: ({ key, value }) => data.set(key, JSON.parse(JSON.stringify(value))) })
      return { get: (key, dflt) => xs.of(data.has(key) ? data.get(key) : dflt) }
    },
  }
}
export function memoryRouter() {
  const routes = new Set()
  let out
  return {
    go: (href) => { const r = href.replace(/^#\//, ''); if (routes.has(r)) out?.next(r) },
    driver: (route$) => {
      route$.addListener({ next: (r) => [r].flat().forEach((x) => routes.add(x)) })
      return xs.create({ start: (l) => { out = l }, stop: () => { out = null } })
    },
  }
}
// todomvc's CSS, as far as what is shown goes
export const todoStyles = [
  ['.todo .edit', { display: 'none' }],
  ['.todo.editing .edit', { display: 'inline' }],
  ['.todo.editing .view', { display: 'none' }],
  ['.todo.completed label', { after: ' ✓', dim: true }],
  ['.filters li', { display: 'inline' }],
  ['.filters a.selected', { before: '*', after: '*' }],
  ['label[for="toggle-all"]', { display: 'none' }],
  ['.todo-leave-active', { after: ' (leaving)' }],
]

function todomvc(todos) {
  const router = memoryRouter()
  const store = memoryStore(todos ? { todos } : {})
  const term = createTerminal({ styles: todoStyles, onNavigate: (href) => router.go(href) })
  apps.push(run(APP, { DOM: term.driver, STORE: store.driver, ROUTER: router.driver }))
  return { term, store }
}

describe('todomvc, unchanged, in a terminal', () => {
  it('renders', async () => {
    const { term } = todomvc([{ id: 1, title: 'Write the spike', completed: false }, { id: 2, title: 'Measure the core', completed: true }])
    await tick()
    expect(term.frame()).toBe([
      'todos',
      '[What needs to be done?]',
      '[ ]',
      '  • [ ] Write the spike [Delete]',
      '  • [x] Measure the core ✓ [Delete]',
      '1 item left',
      '*All* Active Completed',
      '[Clear completed]',
    ].join('\n'))
  })

  it('adds through the form (processForm), clears the input (a ref in an EFFECT)', async () => {
    const { term, store } = todomvc()
    await tick()
    term.press('Tab')
    term.type('Port to a TUI')
    term.press('Enter')
    await tick()
    expect(term.frame()).toContain('• [ ] Port to a TUI [Delete]')
    expect(term.doc.querySelector('.new-todo').value).toBe('')
    await tick()
    expect(store.data.get('todos')).toEqual([{ id: 1, title: 'Port to a TUI', completed: false }])
  })

  it('toggles; F2 edits (dblclick → autoFocus); a link filters; Transition keeps a leaving item', async () => {
    const { term } = todomvc([{ id: 1, title: 'a', completed: false }, { id: 2, title: 'b', completed: false }])
    await tick(20) // BOOTSTRAP's next('ADD_ROUTE') runs after 10 ms
    term.focus('.todo-1 .toggle')
    term.press(' ')
    await tick()
    expect(term.frame()).toContain('[x] a ✓')

    // the label is reachable: the app listens to dblclick on it
    expect(term.focusables().map((e) => e.localName)).toContain('label')
    term.focus('.todo-2 label')
    term.press('F2')
    await tick(30)
    expect(term.doc.activeElement.className).toBe('edit')
    term.press('Backspace')
    term.type('bee')
    term.press('Enter')
    await tick()
    expect(term.frame()).toContain('• [ ] bee [Delete]')

    term.focus('a[href="#/active"]')
    term.press('Enter')
    await tick()
    const f = term.frame()
    expect(f).toContain('*Active*')
    expect(f).toMatch(/\[x\] a ✓ \[Delete\]\s+\(leaving\)/)
    await tick(350)
    expect(term.frame()).not.toContain('[x] a')
  })
})

describe('the painter', () => {
  const doc = new HostDocument()
  const { Go } = controls({ Go: 'button' })
  function Page() {
    return h('main', null,
      h('h1', null, 'Title'),
      h('p', null, 'A long paragraph that wraps at the width of the terminal, between words.'),
      h('ol', null, h('li', null, 'one'), h('li', null, 'two')),
      h('select', { value: 'm' }, h('option', { value: 's' }, 'Small'), h('option', { value: 'm' }, 'Medium')),
      h('input', { type: 'radio', checked: true }), h(Go, null, 'Go'),
      h('pre', null, 'a  b\n  c'),
      h('hr'),
    )
  }
  it('lays out blocks, lists, widgets, wrapping and preformatted text', async () => {
    const app = run(Page, { DOM: makeHostDriver(doc) })
    apps.push(app)
    await tick()
    doc.querySelector(String(Go)).focus()
    const f = paint(doc, { width: 30 })
    expect(f.plain).toEqual([
      'Title',
      'A long paragraph that wraps at',
      'the width of the terminal,',
      'between words.',
      '  1. one',
      '  2. two',
      '[Medium ▾] (•) ▸[Go]',
      'a  b',
      '  c',
      '──────────────────────────────',
    ])
    expect(f.focusLine).toBe(6)
    // ANSI: the heading bold, the focused button inverse
    expect(f.ansi[0]).toBe('\x1b[1mTitle\x1b[0m')
    expect(f.ansi[6]).toContain('\x1b[7m[Go]')
  })
})

describe('keys', () => {
  it('parses raw TTY input into DOM key names', () => {
    expect(parseKeys('a\r\t\x1b[Z\x1b[A\x7f\x1bOQ\x03 é')).toEqual([
      { key: 'a' }, { key: 'Enter' }, { key: 'Tab' }, { key: 'Tab', shiftKey: true }, { key: 'ArrowUp' },
      { key: 'Backspace' }, { key: 'F2' }, { key: 'c', ctrlKey: true }, { key: ' ' }, { key: 'é' },
    ])
  })

  it('runTerminal: raw keys in, frames out, Ctrl+C stops and disposes', async () => {
    const { Inc } = controls({ Inc: 'button' })
    function Counter({ state }) { return h('div', null, h('p', null, `n=${state.n}`), h(Inc, null, '+')) }
    Counter.initialState = { n: 0 }
    Counter.intent = ({ DOM }) => ({ INC: DOM.click(Inc) })
    Counter.model = { INC: (s) => ({ n: s.n + 1 }) }
    const stdin = Object.assign(new EventEmitter(), { setEncoding() {} })
    let out = ''
    const stdout = Object.assign(new EventEmitter(), { columns: 40, rows: 10, write: (s) => { out += s } })
    let exited = false
    const t = runTerminal(Counter, { stdin, stdout, footer: false, onExit: () => { exited = true } })
    await tick()
    stdin.emit('data', '\t\r\r')
    await tick()
    expect(out.trim().split('\n').slice(-2)).toEqual(['n=2', '▸[+]'])
    stdin.emit('data', '\x03')
    expect(exited).toBe(true)
    expect(t.terminal.doc.body.childNodes.length).toBe(0)
  })
})
