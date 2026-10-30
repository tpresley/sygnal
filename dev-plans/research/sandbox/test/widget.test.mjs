// <Sandboxed> in a real host app (the core and the DOM driver on jsdom): the guest's EVENTS reach
// the host's intent as DOM events on the tag, `input` reaches the guest's PROPS, a killed sandbox
// becomes a 'sandboxerror' event, and the guest's elements never trigger the host's intents.
import {test} from 'node:test'
import assert from 'node:assert/strict'
import {JSDOM} from 'jsdom'

const dom = new JSDOM('<!doctype html><div id="root"></div>', {pretendToBeVisual: true})
for (const k of ['window', 'document', 'Node', 'Element', 'HTMLElement', 'Event', 'CustomEvent', 'MouseEvent', 'KeyboardEvent', 'MutationObserver', 'requestAnimationFrame', 'cancelAnimationFrame', 'getComputedStyle', 'navigator', 'location', 'EventTarget', 'DocumentFragment', 'Text'])
  if (!(k in globalThis) || k === 'navigator' || k === 'Event' || k === 'EventTarget' || k === 'CustomEvent') Object.defineProperty(globalThis, k, {value: dom.window[k], configurable: true, writable: true})

const {run, createElement: h} = await import('sygnal')
const {makeSandboxed} = await import('../src/Sandboxed.js')
const {compile} = await import('../src/compile.js')
const {kernel, QJS, settle} = await import('./helpers.mjs')
const Sandboxed = makeSandboxed(QJS, kernel)

// what a model wrote (see generated.test.mjs for the whole path): a list the host fills, a pick
const picker = compile(`
  export default function Picker({ state }) {
    return <ul className="picker">{(state.items || []).map(it =>
      <li><button className="pick danger" data-id={it.id}>{it.label}</button></li>)}</ul>
  }
  Picker.intent = ({ DOM, PROPS }) => ({
    ITEMS: PROPS.get('items'),
    PICK: DOM.select('.pick').events('click').map(e => +e.target.dataset.id),
  })
  Picker.model = {
    ITEMS: (s, items) => ({ ...s, items }),
    PICK: { EVENTS: (s, id) => ({ type: 'PICKED', data: s.items.find(i => i.id === id) }) },
  }
`)
const looper = compile(`
  export default function L() { return <button className="spin">spin</button> }
  L.intent = ({ DOM }) => ({ GO: DOM.select('.spin').events('click') })
  L.model = { GO: (s) => { for (;;) {} } }
`)

function Host({state}) {
  return h('div', null,
    h('button', {className: 'danger'}, 'delete everything'),
    h(Sandboxed, {className: 'gen', key: state.src, source: state.src === 'picker' ? picker : looper, input: {items: state.items}}),
    h('p', {className: 'picked'}, state.picked),
    h('p', {className: 'failed'}, state.failed),
    h('p', {className: 'deleted'}, String(state.deleted)),
    h('button', {className: 'more'}, 'more'),
    h('button', {className: 'swap'}, 'swap'))
}
Host.initialState = {src: 'picker', items: [{id: 1, label: 'Tea'}, {id: 2, label: 'Coffee'}], picked: '', failed: '', deleted: 0}
Host.intent = ({DOM}) => ({
  PICK: DOM.select('.gen').events('emit').detail().filter(e => e.type === 'PICKED').map(e => e.data),
  FAIL: DOM.select('.gen').events('sandboxerror').detail(),
  DELETE: DOM.select('.danger').events('click'),
  MORE: DOM.select('.more').events('click'),
  SWAP: DOM.select('.swap').events('click'),
})
Host.model = {
  PICK: (s, it) => ({...s, picked: it.label}),
  FAIL: (s, e) => ({...s, failed: e.reason, src: 'picker'}),
  DELETE: (s) => ({...s, deleted: s.deleted + 1}),
  MORE: (s) => ({...s, items: [...s.items, {id: 3, label: 'Juice'}]}),
  SWAP: (s) => ({...s, src: 'looper'}),
}

test('a sandboxed tag in a host app', async () => {
  const app = run(Host, {}, {mountPoint: '#root'})
  await settle(20)
  const $ = (s) => document.querySelector(s), $$ = (s) => [...document.querySelectorAll(s)]
  const click = (el) => el.dispatchEvent(new window.MouseEvent('click', {bubbles: true, cancelable: true}))
  assert.deepEqual($$('.gen .pick').map(b => b.textContent), ['Tea', 'Coffee'])

  click($$('.gen .pick')[1])
  await settle(5)
  assert.equal($('.picked').textContent, 'Coffee', 'the guest\'s EVENTS reached the host\'s intent')
  assert.equal($('.deleted').textContent, '0', 'the guest\'s .danger button never reached the host\'s DOM.select(".danger")')

  click($('.more'))
  await settle(5)
  assert.deepEqual($$('.gen .pick').map(b => b.textContent), ['Tea', 'Coffee', 'Juice'], 'input → PROPS')

  click($$('.danger')[0])
  await settle(5)
  assert.equal($('.deleted').textContent, '1', 'the host\'s own button still works')
  app.dispose()
})

test('a sandbox that dies becomes a sandboxerror event; the host recovers', async () => {
  document.body.innerHTML = '<div id="root"></div>'
  const app = run(Host, {}, {mountPoint: '#root'})
  await settle(20)
  document.querySelector('.swap').dispatchEvent(new window.MouseEvent('click', {bubbles: true}))
  await settle(20)
  document.querySelector('.spin').dispatchEvent(new window.MouseEvent('click', {bubbles: true}))
  await settle(20)
  assert.equal(document.querySelector('.failed').textContent, 'timeout')
  // the host swapped the source back (keyed by it): a fresh sandbox mounted
  assert.equal(document.querySelectorAll('.gen .pick').length, 2)
  app.dispose()
})
