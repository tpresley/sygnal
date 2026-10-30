// @vitest-environment jsdom
// sygnal/primitives on the web, the terminal and the agent UI; sygnal/react-native in jsdom with
// react-native stubbed onto react-dom (test/fixtures/react-native-stub.js): mapping, events,
// controlled fields, styles, lists, and the incremental rendering's render counts.
import { describe, it, expect, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { run, createElement as h, controls, Collection, makeDOMDriver } from 'sygnal'
import { View, Text, Pressable, TextInput, Switch, Image, List } from 'sygnal/primitives'
import { registerFieldTags } from 'sygnal/host'
import { createTerminal } from 'sygnal/terminal'
import { runAgentUI } from 'sygnal/agent-ui'

vi.mock('react-native', () => import('./fixtures/react-native-stub.js'))
const { createNativeHost } = await import('sygnal/react-native')

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms))
const cleanup = []
afterEach(() => { cleanup.splice(0).forEach((f) => f()); document.body.innerHTML = '' })

// one component file for every target
const { Inc, Draft, Add, Done } = controls({ Inc: Pressable, Draft: TextInput, Add: Pressable, Done: Switch })
function Item({ state }) {
  return h(View, { className: state.done ? 'item done' : 'item', style: { flexDirection: 'row', gap: 8 } },
    h(Done, { value: state.done, accessibilityLabel: `Done: ${state.title}` }),
    h(Text, { className: 'title' }, state.title))
}
Item.intent = ({ DOM }) => ({ TOGGLE: DOM.change(Done) })
Item.model = { TOGGLE: (s) => ({ ...s, done: !s.done }) }
function Shop({ state }) {
  return h(View, { style: { padding: 16, gap: 8 } },
    h(Text, { className: 'count', style: { fontSize: 20 } }, `${state.n} taps, ${state.items.filter((i) => !i.done).length} to buy`),
    h(Image, { source: { uri: 'https://example.com/cart.png' }, alt: 'Cart', style: { width: 24, height: 24 } }),
    h(View, { style: { flexDirection: 'row', gap: 8 } }, h(Draft, { value: state.draft, placeholder: 'Add an item' }), h(Add, null, 'Add')),
    h(Inc, { accessibilityLabel: 'Tap' }, '+1'),
    h(List, null, h(Collection, { of: Item, from: 'items' })))
}
Shop.initialState = { n: 0, draft: '', items: [{ id: 1, title: 'Apples', done: false }] }
Shop.intent = ({ DOM }) => ({ TAP: DOM.click(Inc), DRAFT: DOM.input(Draft).value(), ADD: DOM.click(Add) })
Shop.model = {
  TAP: (s) => ({ ...s, n: s.n + 1 }),
  DRAFT: (s, draft) => ({ ...s, draft }),
  ADD: (s) => (s.draft.trim() ? { ...s, draft: '', items: [...s.items, { id: s.items.length + 1, title: s.draft.trim(), done: false }] } : s),
}

describe('sygnal/primitives', () => {
  it('render HTML on the web (DOM driver): flex columns, px lengths, a switch input', async () => {
    document.body.innerHTML = '<div id="app"></div>'
    const app = run(Shop, { DOM: makeDOMDriver('#app') })
    cleanup.push(() => app.dispose())
    await tick()
    const root = document.getElementById('app')
    const outer = root.firstElementChild
    expect(outer.dataset.primitive).toBe('View')
    expect(outer.getAttribute('style')).toBe('box-sizing: border-box; border-width: 0px; border-style: solid; position: relative; min-width: 0px; flex-shrink: 0; display: flex; flex-direction: column; padding: 16px; gap: 8px;')
    expect(outer.firstElementChild.outerHTML).toBe('<span style="font-size: 20px;" class="count" data-primitive="Text">0 taps, 1 to buy</span>')
    const sw = root.querySelector('[data-primitive="Switch"]')
    expect([sw.type, sw.getAttribute('role'), sw.getAttribute('aria-label'), sw.dataset.control]).toEqual(['checkbox', 'switch', 'Done: Apples', 'Done'])
    expect(root.querySelector('img').getAttribute('src')).toBe('https://example.com/cart.png')
    root.querySelector(String(Inc)).click()
    root.querySelector(String(Done)).click()
    await tick()
    expect(root.querySelector('.count').textContent).toBe('1 taps, 0 to buy')
  })

  it('in a terminal and for an agent, unchanged', async () => {
    const term = createTerminal()
    const a = run(Shop, { DOM: term.driver })
    cleanup.push(() => a.dispose())
    await tick()
    expect(term.frame()).toBe('0 taps, 1 to buy\n[Cart]\n[Add an item] [Add]\n[+1]\n[ ] Apples')
    const { app, ui } = runAgentUI(Shop)
    cleanup.push(() => app.dispose())
    await ui.settle()
    expect(ui.snapshot().replace(/e\d+/g, 'e')).toBe([
      '- text: 0 taps, 1 to buy',
      '- img "Cart"',
      '- textbox "Add an item" [ref=e]',
      '- button "Add" [ref=e]',
      '- button "Tap" [ref=e]',
      '- list:',
      '  - switch "Done: Apples" [ref=e]',
      '  - text: Apples',
    ].join('\n'))
  })
})

async function mountNative(App, options = {}, onCommit) {
  const el = document.createElement('div')
  document.body.append(el)
  const root = createRoot(el)
  const host = createNativeHost(options)
  const app = run(App, { DOM: host.driver })
  const React = await import('react')
  await act(async () => { root.render(React.createElement(React.Profiler, { id: 'sygnal', onRender: () => onCommit?.() }, React.createElement(host.Root))); await tick(10) })
  cleanup.push(() => { host.stop(); app.dispose(); act(() => root.unmount()) })
  return { el, host, app }
}
const act$ = (f) => act(async () => { f(); await tick(10) })

describe('sygnal/react-native (jsdom, react-native stubbed)', () => {
  it('maps primitives to React Native components, and native callbacks drive the intents', async () => {
    const { el } = await mountNative(Shop)
    const rn = (name) => [...el.querySelectorAll(`[data-rn="${name}"]`)]
    expect(rn('Image')[0].getAttribute('src')).toBe('https://example.com/cart.png')
    expect(rn('FlatList')).toHaveLength(1)
    await act$(() => rn('Pressable').find((b) => b.getAttribute('aria-label') === 'Tap').click())
    expect(el.textContent).toContain('1 taps, 1 to buy')
    // a controlled TextInput: typing, then the app clears it after Add
    const input = rn('TextInput')[0]
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    await act$(() => { setValue.call(input, 'Pears'); input.dispatchEvent(new Event('input', { bubbles: true })) })
    expect(input.value).toBe('Pears')
    await act$(() => rn('Pressable').find((b) => b.textContent === 'Add').click())
    expect(rn('TextInput')[0].value).toBe('')
    expect(el.textContent).toContain('2 to buy')
    // a Switch: onValueChange → a checkbox's click + input + change → the item's intent
    await act$(() => rn('Switch')[1].click())
    expect(el.textContent).toContain('1 to buy')
    expect(rn('Switch')[1].checked).toBe(true)
  })

  it('styles: rules, inline styles (px back to numbers), text keys on the Text a View wraps its text in', async () => {
    function Card() {
      return h('div', { className: 'card' }, 'Hello', h('button', { className: 'go' }, 'Go'), h(View, { style: { padding: 12 } }, h(Text, null, 'x')))
    }
    const { el } = await mountNative(Card, { styles: [['.card', { backgroundColor: 'yellow', color: 'red' }], ['.card .go', { backgroundColor: 'black' }]] })
    const card = el.querySelector('[data-rn="View"] [data-rn="View"]')
    expect(card.style.backgroundColor).toBe('yellow')
    expect(card.querySelector('[data-rn="Text"]').style.color).toBe('red')
    // defaultNativeStyles' button, then the app's descendant rule
    const go = el.querySelector('[data-rn="Pressable"]')
    expect(go.style.backgroundColor).toBe('black')
    expect(go.querySelector('[data-rn="Text"]').style.color).toBe('rgb(255, 255, 255)')
    expect(el.querySelectorAll('[data-rn="View"]')[2].style.padding).toBe('12px')
  })

  it('HTML views run as they are: inline content in a row, select steps through its options', async () => {
    const { Size } = controls({ Size: 'select' })
    function Form({ state }) {
      return h('form', null, h('label', null, h('input', { type: 'checkbox', checked: state.on }), 'On'), h(Size, { value: state.size }, h('option', { value: 's' }, 'Small'), h('option', { value: 'm' }, 'Medium')), h('p', null, state.size))
    }
    Form.initialState = { on: false, size: 's' }
    Form.intent = ({ DOM }) => ({ SIZE: DOM.change(Size).value() })
    Form.model = { SIZE: (s, size) => ({ ...s, size }) }
    const { el } = await mountNative(Form)
    const label = el.querySelector('[data-rn="Switch"]').parentElement
    expect(label.style.flexDirection).toBe('row')
    const select = [...el.querySelectorAll('[data-rn="Pressable"]')].find((b) => b.textContent.includes('▾'))
    expect(select.textContent).toBe('Small ▾')
    await act$(() => select.click())
    expect(el.textContent).toContain('Medium ▾m')
  })

  it('a registered checkbox-kind tag is a Switch', async () => {
    registerFieldTags({ tag: 'toggle', kind: 'checkbox' })
    const { T } = controls({ T: 'toggle' })
    function Tog({ state }) { return h('div', null, h(T, { checked: state.on }), h('p', null, state.on ? 'on' : 'off')) }
    Tog.initialState = { on: false }
    Tog.intent = ({ DOM }) => ({ FLIP: DOM.change(T) })
    Tog.model = { FLIP: (s) => ({ on: !s.on }) }
    const { el } = await mountNative(Tog)
    await act$(() => el.querySelector('[data-rn="Switch"]').click())
    expect(el.textContent).toBe('on')
  })

  it('incremental: a change re-renders the changed path only (render counts)', async () => {
    function Big({ state }) { return h(View, null, h(Inc, null, `${state.n}`), h(List, null, h(Collection, { of: Item, from: 'items' }))) }
    Big.initialState = { n: 0, items: Array.from({ length: 100 }, (_, i) => ({ id: i + 1, title: 'item ' + i, done: false })) }
    Big.intent = ({ DOM }) => ({ TAP: DOM.click(Inc) })
    Big.model = { TAP: (s) => ({ ...s, n: s.n + 1 }) }
    const counts = {}
    for (const incremental of [false, true]) {
      let renders = 0, commits = 0, names = []
      const { el } = await mountNative(Big, { incremental, onNodeRender: (n) => { renders++; names.push(n.dataset.primitive || n.localName) } }, () => { commits++ })
      const initial = renders
      renders = 0; commits = 0
      await act$(() => el.querySelector('[data-rn="Pressable"]').click())
      const tap = renders, tapCommits = commits
      renders = 0; commits = 0
      await act$(() => el.querySelectorAll('[data-rn="Switch"]')[50].click())
      counts[incremental ? 'incremental' : 'full'] = { initial, tap, toggle: renders, commits: [tapCommits, commits] }
      if (incremental) expect(names.slice(-renders)).toEqual(['View', 'List', 'View', 'Switch'])
    }
    // 1 + 1 + 1 + 100 × 3 elements (an item: its View, Switch, Text)
    // one React commit per change either way; what differs is how many elements render in it
    expect(counts.full).toEqual({ initial: 303, tap: 303, toggle: 303, commits: [1, 1] })
    // the tap: the root View and the Pressable; the toggle: the root, the List, the item, its Switch
    expect(counts.incremental).toEqual({ initial: 303, tap: 2, toggle: 4, commits: [1, 1] })
  })
})
