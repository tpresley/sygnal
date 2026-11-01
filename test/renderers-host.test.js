// sygnal/host (research: dev-plans/research/alt-renderers): the host tree, the host driver's
// source contract (selectors, isolation, document listeners), the user-agent actions, and
// registerFieldTags (the pragma's field bit for a target's own tags, C10).
import { describe, it, expect, afterEach } from 'vitest'
import { run, createElement as h, controls, Collection, xs } from 'sygnal'
import {
  HostDocument, HostEvent, makeHostDriver, registerFieldTags, matches, activate, pressKey, typeText,
  fill, chooseOption, focusableElements, isInteractive, computeStyle, isHidden, nodeId,
} from 'sygnal/host'

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms))
const apps = []
afterEach(() => apps.splice(0).forEach((a) => a.dispose()))
function mount(App, drivers = {}) {
  const doc = new HostDocument()
  const app = run(App, { ...drivers, DOM: makeHostDriver(doc) })
  apps.push(app)
  return { doc, app }
}

describe('host tree', () => {
  it('reflects properties to attributes, as the DOM does', () => {
    const doc = new HostDocument()
    const el = doc.createElement('input')
    el.type = 'checkbox'
    el.className = 'a b'
    el.disabled = true
    expect(el.getAttribute('type')).toBe('checkbox')
    expect(el.classList.contains('b')).toBe(true)
    expect(el.hasAttribute('disabled')).toBe(true)
    expect(el.matches('input[type="checkbox"].a:not(.c)')).toBe(true)
  })

  it('selectors: lists, descendant and child combinators, attribute operators, :focus', () => {
    const doc = new HostDocument()
    const ul = doc.createElement('ul'), li = doc.createElement('li'), a = doc.createElement('a')
    doc.body.appendChild(ul); ul.appendChild(li); li.appendChild(a)
    a.href = '#/active'
    expect(matches(a, 'ul a')).toBe(true)
    expect(matches(a, 'ul > a')).toBe(false)
    expect(matches(a, 'ul > li > a[href^="#/"]')).toBe(true)
    expect(matches(a, 'p, a[href$="active"]')).toBe(true)
    expect(matches(a, 'a:focus')).toBe(false)
    a.focus()
    expect(matches(a, 'a:focus')).toBe(true)
    expect(() => matches(a, 'a:hover')).toThrow(/unsupported selector/)
  })

  it('events bubble after the root delegates; preventDefault is reported', () => {
    const doc = new HostDocument()
    const div = doc.createElement('div'), b = doc.createElement('button')
    doc.body.appendChild(div); div.appendChild(b)
    const seen = []
    div.addEventListener('click', (e) => { seen.push('div:' + e.currentTarget.localName); e.preventDefault() })
    expect(b.dispatchEvent(new HostEvent('click'))).toBe(false)
    expect(seen).toEqual(['div:div'])
    // non-bubbling: the target only
    div.addEventListener('focus', () => seen.push('div focus'))
    b.focus()
    expect(seen).toEqual(['div:div'])
    expect(doc.activeElement).toBe(b)
  })

  it('a stylesheet: rules in order, inline style and hidden win', () => {
    const doc = new HostDocument()
    const p = doc.createElement('p'), s = doc.createElement('span')
    doc.body.appendChild(p); p.appendChild(s)
    const rules = [['p', { display: 'none' }], ['.on', { display: 'block' }]]
    expect(isHidden(s, rules)).toBe(true)
    p.className = 'on'
    expect(isHidden(s, rules)).toBe(false)
    p.style.display = 'none'
    expect(computeStyle(p, rules).display).toBe('none')
  })
})

describe('makeHostDriver: the DOM driver contract on a host tree', () => {
  const { Inc } = controls({ Inc: 'button' })
  function Counter({ state }) {
    return h('div', { className: 'counter' }, h('span', { className: 'count' }, `Count: ${state.count}`), h(Inc, null, '+'))
  }
  Counter.initialState = { count: 0 }
  Counter.intent = ({ DOM }) => ({ INC: DOM.click(Inc) })
  Counter.model = { INC: (s) => ({ count: s.count + 1 }) }

  it('renders, and a host event drives the intent', async () => {
    const { doc } = mount(Counter)
    await tick()
    expect(doc.body.querySelector('.count').textContent).toBe('Count: 0')
    doc.body.querySelector(String(Inc)).click()
    doc.body.querySelector(String(Inc)).click()
    await tick()
    expect(doc.body.querySelector('.count').textContent).toBe('Count: 2')
  })

  it('total isolation: a parent selector never matches a child component\'s elements', async () => {
    function Item({ state }) { return h('li', { className: 'item' }, h('button', { className: 'go' }, state.label)) }
    Item.intent = ({ DOM }) => ({ HIT: DOM.click('.go') })
    Item.model = { HIT: (s) => ({ ...s, hits: (s.hits || 0) + 1 }) }
    function List({ state }) { return h('div', null, h('button', { className: 'go' }, 'all'), h('ul', null, h(Collection, { of: Item, from: 'items' }))) }
    List.initialState = { all: 0, items: [{ id: 1, label: 'a' }] }
    List.intent = ({ DOM }) => ({ ALL: DOM.click('.go') })
    List.model = { ALL: (s) => ({ ...s, all: s.all + 1 }) }
    const { doc, app } = mount(List)
    await tick()
    const [all, item] = doc.body.querySelectorAll('.go')
    item.click()
    await tick()
    expect(app.__runtime.getState()).toMatchObject({ all: 0, items: [{ hits: 1 }] })
    all.click()
    await tick()
    expect(app.__runtime.getState()).toMatchObject({ all: 1, items: [{ hits: 1 }] })
    // the ancestor the parent's selector matches is the parent's own: an item's click doesn't bubble into it
    expect(doc.listenedTypes(item)).toEqual(['click'])
  })

  it("DOM.select('document') hears every component's events (app-wide keys)", async () => {
    function Keys({ state }) { return h('div', null, h('input', { className: 'f' }), h('p', null, state.keys.join(','))) }
    Keys.initialState = { keys: [] }
    Keys.intent = ({ DOM }) => ({ KEY: DOM.select('document').events('keydown').key() })
    Keys.model = { KEY: (s, k) => ({ keys: [...s.keys, k] }) }
    const { doc } = mount(Keys)
    await tick()
    pressKey(doc.body.querySelector('.f'), 'x')
    pressKey(doc.body, 'Escape')
    await tick()
    expect(doc.body.querySelector('p').textContent).toBe('x,Escape')
    expect(doc.globalTypes()).toEqual(['keydown'])
  })

  it('dispose removes the app\'s elements', async () => {
    const { doc, app } = mount(Counter)
    await tick()
    app.dispose()
    expect(doc.body.childNodes.length).toBe(0)
  })

  it('a patch that throws goes to run()\'s onError with phase patch', async () => {
    const errors = []
    function Bad() { return h('div', { hook: { insert: () => { throw new Error('boom') } } }, 'x') }
    const doc = new HostDocument()
    const app = run(Bad, { DOM: makeHostDriver(doc) }, { onError: (e, info) => errors.push([e.message, info.phase]) })
    apps.push(app)
    await tick()
    expect(errors).toEqual([['boom', 'patch']])
  })
})

describe('user-agent actions', () => {
  it('a checkbox toggles before its click and gets input + change; a label clicks its control', () => {
    const doc = new HostDocument()
    const box = doc.createElement('input'), label = doc.createElement('label')
    box.type = 'checkbox'; box.id = 'c'; label.htmlFor = 'c'
    doc.body.append(box, label)
    const seen = []
    for (const t of ['click', 'input', 'change']) box.addEventListener(t, (e) => seen.push(`${e.type}:${box.checked}`))
    activate(label)
    expect(seen).toEqual(['click:true', 'input:true', 'change:true'])
    box.addEventListener('click', (e) => e.preventDefault())
    activate(box)
    expect(box.checked).toBe(true)
  })

  it('typing, Enter submits the form, fill and chooseOption', () => {
    const doc = new HostDocument()
    const form = doc.createElement('form'), input = doc.createElement('input'), sel = doc.createElement('select')
    input.name = 'q'
    for (const v of ['s', 'm']) { const o = doc.createElement('option'); o.setAttribute('value', v); o.textContent = v == 's' ? 'Small' : 'Medium'; sel.appendChild(o) }
    sel.value = 's'
    form.append(input, sel)
    doc.body.appendChild(form)
    const seen = []
    form.addEventListener('submit', () => seen.push('submit:' + [...form.toFormData().entries()].map(([k, v]) => k + '=' + v).join('&')))
    input.addEventListener('input', () => seen.push('input'))
    typeText(input, 'hi')
    pressKey(input, 'Enter')
    expect(seen).toEqual(['input', 'input', 'submit:q=hi'])
    fill(input, 'yo')
    expect(input.value).toBe('yo')
    expect(chooseOption(sel, 'Medium')).toBe(true)
    expect(sel.value).toBe('m')
  })

  it('interactive by intent: an element the app listens to clicks on is reachable', async () => {
    function Edit({ state }) { return h('div', null, h('label', { className: 'title' }, state.title), h('button', null, 'x')) }
    Edit.initialState = { title: 'a', editing: false }
    Edit.intent = ({ DOM }) => ({ EDIT: DOM.dblclick('.title') })
    Edit.model = { EDIT: (s) => ({ ...s, editing: true }) }
    const { doc } = mount(Edit)
    await tick()
    const label = doc.body.querySelector('.title')
    expect(isInteractive(label)).toBe(true)
    expect(focusableElements(doc).map((e) => e.localName)).toEqual(['button'])
    expect(focusableElements(doc, [], { listened: true }).map((e) => e.localName)).toEqual(['label', 'button'])
    expect(nodeId(label)).toBe(nodeId(label))
  })
})

describe('registerFieldTags (C10)', () => {
  // typed text, then a state set back to the value it rendered last: an <input> is written again
  // because the pragma never reuses a field vnode; a target's own field tag needs the registry
  const field = (tag) => {
    const { Box, Clear } = controls({ Box: tag, Clear: 'button' })
    function F({ state }) { return h('div', null, h(Box, { value: state.v }), h(Clear, null, 'x')) }
    F.initialState = { v: '' }
    F.intent = ({ DOM }) => ({ CLEAR: DOM.click(Clear) })
    F.model = { CLEAR: (s) => ({ ...s, v: '' }) }
    return { F, Box, Clear }
  }
  async function typeThenClear(tag) {
    const { F, Box, Clear } = field(tag)
    const { doc } = mount(F)
    await tick()
    const box = doc.body.querySelector(String(Box))
    typeText(box, 'abc')
    doc.body.querySelector(String(Clear)).click()
    await tick()
    return box.value
  }
  it('an <input> is written again', async () => {
    expect(await typeThenClear('input')).toBe('')
  })
  it('a registered tag is too', async () => {
    registerFieldTags('textentry')
    expect(await typeThenClear('textentry')).toBe('')
  })
})
