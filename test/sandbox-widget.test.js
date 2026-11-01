// @vitest-environment jsdom
// <Sandboxed> in a host app (the core and the DOM driver on jsdom): the guest's declared, valid
// EVENTS reach the host's intent as `emit` DOM events on the tag, `input` reaches the guest's
// PROPS, a killed sandbox becomes a `sandboxerror` event, a new `source` replaces the sandbox, and
// the guest's elements never trigger the host's intents.
import { describe, it, expect, afterEach } from 'vitest'
import { compile, kernel, settle, until, schema, nodeWorker } from './fixtures/sandbox-helpers.js'
import { createElement as h } from '../src/pragma/index.js'
import run from '../src/extra/run.ts'
import { Sandboxed, sandboxed } from '../src/sandbox.ts'

afterEach(() => { document.body.innerHTML = '' })

const picker = compile(`
  export default function Picker({ state }) {
    return <ul className="picker">{(state.items || []).map(it =>
      <li><button className="pick danger" data-id={it.id}>{it.label}</button></li>)}</ul>
  }
  Picker.intent = ({ DOM, PROPS }) => ({ ITEMS: PROPS.get('items'), PICK: DOM.select('.pick').events('click').map(e => +e.target.dataset.id) })
  Picker.model = {
    ITEMS: (s, items) => ({ ...s, items }),
    PICK: { EVENTS: (s, id) => id === 2 ? { type: 'PICKED', data: { label: 42 } } : { type: 'PICKED', data: s.items.find(i => i.id === id) } },
  }
`)
const looper = compile(`
  export default function L() { return <button className="spin">spin</button> }
  L.intent = ({ DOM }) => ({ GO: DOM.select('.spin').events('click') })
  L.model = { GO: (s) => { for (;;) {} } }
`)
const Picked = schema((v) => (typeof v?.label == 'string' ? undefined : 'label must be a string'))

function hostApp(Tag, extra = {}) {
  function Host({ state }) {
    return h('div', null,
      h('button', { className: 'danger' }, 'delete everything'),
      h(Tag, { className: 'gen', kernel, source: state.src === 'picker' ? picker : looper, emits: { PICKED: Picked }, input: { items: state.items }, isolation: 'thread', ...extra }),
      h('p', { className: 'picked' }, state.picked),
      h('p', { className: 'failed' }, state.failed),
      h('p', { className: 'deleted' }, String(state.deleted)),
      h('button', { className: 'more' }, 'more'),
      h('button', { className: 'swap' }, 'swap'))
  }
  Host.initialState = { src: 'picker', items: [{ id: 1, label: 'Tea' }, { id: 2, label: 'Coffee' }], picked: '', failed: '', deleted: 0 }
  Host.intent = ({ DOM }) => ({
    PICK: DOM.select('.gen').events('emit').detail().filter((e) => e.type === 'PICKED').map((e) => e.data),
    FAIL: DOM.select('.gen').events('sandboxerror').detail(),
    DELETE: DOM.select('.danger').events('click'),
    MORE: DOM.select('.more').events('click'),
    SWAP: DOM.select('.swap').events('click'),
  })
  Host.model = {
    PICK: (s, it) => ({ ...s, picked: s.picked + it.label }),
    FAIL: (s, e) => ({ ...s, failed: e.reason, src: 'picker' }),
    DELETE: (s) => ({ ...s, deleted: s.deleted + 1 }),
    MORE: (s) => ({ ...s, items: [...s.items, { id: 3, label: 'Juice' }] }),
    SWAP: (s) => ({ ...s, src: 'looper' }),
  }
  return Host
}
const $ = (s) => document.querySelector(s), $$ = (s) => [...document.querySelectorAll(s)]
const click = (el) => el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))

describe('<Sandboxed>', () => {
  it('in a host app: validated EVENTS reach the intent, input reaches PROPS, guest elements never reach host intents', async () => {
    document.body.innerHTML = '<div id="root"></div>'
    const app = run(hostApp(Sandboxed), {}, { mountPoint: '#root' })
    await until(() => $$('.gen .pick').length === 2)
    expect($$('.gen .pick').map((b) => b.textContent)).toEqual(['Tea', 'Coffee'])

    click($$('.gen .pick')[0])
    click($$('.gen .pick')[1]) // the guest sends { label: 42 }: invalid, dropped
    await settle(5)
    expect($('.picked').textContent).toBe('Tea')
    expect($('.deleted').textContent).toBe('0')

    click($('.more'))
    await until(() => $$('.gen .pick').length === 3)
    expect($$('.gen .pick').map((b) => b.textContent)).toEqual(['Tea', 'Coffee', 'Juice'])

    click($$('.danger')[0])
    await settle(5)
    expect($('.deleted').textContent).toBe('1')
    app.dispose()
  })

  it('a sandbox that dies becomes a sandboxerror event; a new source replaces the sandbox', async () => {
    document.body.innerHTML = '<div id="root"></div>'
    const app = run(hostApp(Sandboxed), {}, { mountPoint: '#root' })
    await until(() => $$('.gen .pick').length === 2)
    click($('.swap'))
    await until(() => $('.spin'))
    expect($$('.gen .pick').length).toBe(0)
    click($('.spin'))
    await until(() => $('.failed').textContent)
    expect($('.failed').textContent).toBe('timeout')
    await until(() => $$('.gen .pick').length === 2)
    app.dispose()
    expect($('.gen')).toBe(null)
  })

  it('sandboxed(defaults) presets props; the worker tier works as a tag', async () => {
    document.body.innerHTML = '<div id="root"></div>'
    const Card = sandboxed({ kernel, worker: nodeWorker, isolation: 'worker' })
    const app = run(hostApp(Card, { kernel: undefined, isolation: undefined }), {}, { mountPoint: '#root' })
    await until(() => $$('.gen .pick').length === 2)
    click($$('.gen .pick')[0])
    await until(() => $('.picked').textContent === 'Tea')
    app.dispose()
  })
})
