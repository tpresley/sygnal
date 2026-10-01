// G-067: a minimal Sygnal app run through a built dist file in plain Node + jsdom.
// Loaded by test/dist-cjs-app.test.js in a child `node` process, so neither Vite nor
// Vitest interop is involved: `require()` of dist/index.cjs.js is exactly what a CJS user
// gets, and native `import()` of dist/index.esm.js is what a plain Node ESM user gets.
// Exercises run() (withState, StateSource, DOM driver, EVENTS bus), a Collection,
// EVENTS between components, ABORT, and an xstream extra (debounce).
//
// Usage: node cjs-app.cjs <path to dist/index.cjs.js | dist/index.esm.js>
// Prints one JSON line: { ok, steps, html, errors, ... } and exits 0 (the test asserts on it).
'use strict'
const { JSDOM } = require('jsdom')
const { pathToFileURL } = require('node:url')

const distFile = process.argv[2]
const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { pretendToBeVisual: true })
const g = dom.window
for (const key of ['window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement', 'Text', 'Event', 'MouseEvent',
  'KeyboardEvent', 'CustomEvent', 'EventTarget', 'MutationObserver', 'requestAnimationFrame', 'cancelAnimationFrame']) {
  Object.defineProperty(globalThis, key, { value: key === 'window' ? g : g[key], configurable: true, writable: true })
}

const errors = []
const origError = console.error
console.error = (...args) => { errors.push(args.map(String).join(' ')) }
console.warn = (...args) => { errors.push('warn: ' + args.map(String).join(' ')) }

const steps = []
function finish(ok, extra = {}) {
  console.error = origError
  process.stdout.write(JSON.stringify({ ok, steps, html: document.getElementById('root')?.innerHTML ?? null, errors, ...extra }) + '\n')
  process.exit(0)
}
process.on('uncaughtException', e => finish(false, { uncaught: String((e && e.stack) || e) }))

/** dist/index.cjs.js: require() (the "require" condition); an .mjs / .esm.js path: native import(). */
async function load() {
  if (/\.(mjs|esm\.js)$/.test(distFile)) return import(pathToFileURL(distFile).href)
  return require(distFile)
}

function defineApp({ createElement: h, Collection, event, debounce, ABORT }) {
  function Item({ state }) {
    return h('li', { className: 'item' }, state.label)
  }

  function Status({ state }) {
    return h('p', { className: 'status' }, state.last)
  }
  Status.intent = ({ EVENTS }) => ({ ADDED: EVENTS.select('ITEM_ADDED') })
  Status.model = { ADDED: (state, label) => ({ ...state, last: label }) }

  function App({ state }) {
    return h('div', null,
      h('button', { className: 'add' }, 'add'),
      h('button', { className: 'reset' }, 'reset'),
      h('span', { className: 'count' }, String(state.count)),
      h('span', { className: 'echo' }, state.echo),
      h(Collection, { of: Item, from: 'items', className: 'list' }),
      h(Status, { state: 'status' }),
    )
  }
  App.initialState = { count: 0, echo: '', items: [], status: { last: 'none' } }
  App.intent = ({ DOM }) => ({
    ADD: DOM.click('.add'),
    RESET: DOM.click('.reset'),
    ECHO: DOM.click('.add').compose(debounce(5)).mapTo('debounced'),
  })
  App.model = {
    ADD: {
      STATE: state => {
        const n = state.count + 1
        return { ...state, count: n, items: [...state.items, { id: n, label: 'item ' + n }] }
      },
      EVENTS: event('ITEM_ADDED', state => 'item ' + (state.count + 1)),
    },
    RESET: state => (state.count === 0 ? ABORT : { ...state, count: 0, items: [] }),
    ECHO: (state, data) => ({ ...state, echo: data }),
  }
  return App
}

const text = sel => document.querySelector(sel)?.textContent ?? null
const count = sel => document.querySelectorAll(sel).length
const click = sel => document.querySelector(sel).dispatchEvent(new g.MouseEvent('click', { bubbles: true }))

function waitFor(label, pred, ms = 2000) {
  const start = Date.now()
  return new Promise((resolve, reject) => {
    const tick = () => {
      let v = false
      try { v = pred() } catch { /* not rendered yet */ }
      if (v) { steps.push(label); resolve() }
      else if (Date.now() - start > ms) reject(new Error('timed out: ' + label))
      else setTimeout(tick, 5)
    }
    tick()
  })
}

async function main() {
  let s
  try {
    s = await load()
  } catch (e) {
    return finish(false, { requireError: String((e && e.stack) || e) })
  }
  const app = s.run(defineApp(s))
  await waitFor('initial render', () => text('.count') === '0' && text('.status') === 'none' && count('.list li') === 0)
  click('.add')
  await waitFor('first click', () => text('.count') === '1' && count('.list li') === 1 && text('.list li') === 'item 1')
  await waitFor('EVENTS to sibling', () => text('.status') === 'item 1')
  await waitFor('debounced extra', () => text('.echo') === 'debounced')
  click('.add')
  await waitFor('second click', () => text('.count') === '2' && count('.list li') === 2 && text('.status') === 'item 2')
  click('.reset')
  await waitFor('reset', () => text('.count') === '0' && count('.list li') === 0)
  app.dispose()
  finish(true)
}

main().catch(e => finish(false, { failure: String((e && e.message) || e) }))
