// The TUI spike (dev-plans/research/tui-spike): sygnal/host's browser behaviours a terminal needs
// (a text field's caret and editing, a <select>'s option list, radio groups, <dialog>, the
// Popover API, <details>, invoker buttons) and sygnal/terminal's boxes, overlays, cell widths,
// mouse, paste, the TERMINAL sink and runTerminal's restore.
import { describe, it, expect, afterEach } from 'vitest'
import { EventEmitter } from 'node:events'
import { run, createElement as h, controls, makeTimerDriver } from 'sygnal'
import { tabs, tabsAttrs, accordion, accordionAttrs, disclosure, disclosureAttrs, popover, tooltip } from 'sygnal/ui'
import { createTerminal, runTerminal, parseKeys, paint, stringWidth, hitTest } from 'sygnal/terminal'
import { HostDocument, HostEvent, pressKey, paste, focusableElements, isInert } from 'sygnal/host'

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms))
const apps = []
afterEach(() => apps.splice(0).forEach((a) => a.dispose()))

/** a host tree from [tag, attrs, ...children] arrays, without an app */
function tree(...nodes) {
  const doc = new HostDocument()
  const make = (n) => {
    if (typeof n == 'string') return doc.createTextNode(n)
    const [tag, attrs = {}, ...kids] = n
    const el = doc.createElement(tag)
    for (const k in attrs) k in { value: 1, checked: 1 } ? (el[k] = attrs[k]) : el.setAttribute(k, attrs[k] === true ? '' : attrs[k])
    for (const c of kids) el.appendChild(make(c))
    return el
  }
  for (const n of nodes) doc.body.appendChild(make(n))
  return doc
}
const log = (el, ...types) => { const out = []; for (const t of types) el.addEventListener(t, (e) => out.push(t + (e.inputType ? ':' + e.inputType : ''))); return out }

describe('sygnal/host: a text field', () => {
  it('edits at the caret: insert, Backspace / Delete, words, Home / End, Shift selects and typing replaces', () => {
    const doc = tree(['input', { value: 'hello world' }])
    const el = doc.querySelector('input')
    el.focus()
    expect([el.selectionStart, el.selectionEnd]).toEqual([11, 11]) // a value puts the caret at its end
    const ev = log(el, 'beforeinput', 'input')
    pressKey(el, 'ArrowLeft', { altKey: true })
    pressKey(el, 'Backspace')
    expect(el.value).toBe('helloworld')
    pressKey(el, ' ')
    pressKey(el, 'Home')
    pressKey(el, 'Delete')
    expect(el.value).toBe('ello world')
    pressKey(el, 'ArrowRight', { shiftKey: true })
    pressKey(el, 'ArrowRight', { shiftKey: true })
    expect([el.selectionStart, el.selectionEnd]).toEqual([0, 2])
    pressKey(el, 'J')
    expect(el.value).toBe('Jlo world')
    pressKey(el, 'End')
    pressKey(el, 'Backspace', { ctrlKey: true })
    expect(el.value).toBe('Jlo ')
    expect(ev.slice(0, 4)).toEqual(['beforeinput:deleteContentBackward', 'input:deleteContentBackward', 'beforeinput:insertText', 'input:insertText'])
    pressKey(el, 'a', { metaKey: true })
    expect([el.selectionStart, el.selectionEnd]).toEqual([0, 4])
  })

  it('moves by grapheme, honours maxlength and a prevented beforeinput; a paste into an <input> loses its line breaks', () => {
    const doc = tree(['input', { value: 'a👍🏽b', maxlength: 6 }])
    const el = doc.querySelector('input')
    el.focus()
    pressKey(el, 'ArrowLeft')
    pressKey(el, 'ArrowLeft')
    expect(el.selectionStart).toBe(1)
    pressKey(el, 'Delete')
    expect(el.value).toBe('ab')
    paste(el, 'x\ny\nzzzz')
    expect(el.value).toBe('ax y b') // 6: the rest cut
    el.addEventListener('beforeinput', (e) => e.preventDefault())
    pressKey(el, 'q')
    expect(el.value).toBe('ax y b')
  })

  it('a <textarea>: Enter breaks the line, ↑ / ↓ move between lines at the same column', () => {
    const doc = tree(['textarea'])
    const el = doc.querySelector('textarea')
    el.focus()
    for (const k of ['a', 'b', 'c', 'Enter', 'd']) pressKey(el, k)
    expect(el.value).toBe('abc\nd')
    pressKey(el, 'ArrowUp')
    expect(el.selectionStart).toBe(1)
    pressKey(el, 'End')
    pressKey(el, 'ArrowDown')
    expect(el.selectionStart).toBe(5)
    pressKey(el, 'Home', { shiftKey: true })
    expect([el.selectionStart, el.selectionEnd]).toEqual([4, 5])
  })
})

describe('sygnal/host: a <select>', () => {
  const opts = () => tree(['select', { value: 'b' }, ['option', { value: 'a' }, 'Apple'], ['option', { value: 'b' }, 'Banana'], ['option', { value: 'c', disabled: true }, 'Cherry'], ['option', { value: 'd' }, 'Date']])
  it('Enter / Space / Alt+↓ / F4 open its list; ↑ ↓ skip disabled options; Enter chooses (input + change once); Escape keeps the value', () => {
    for (const [key, init] of [['Enter'], [' '], ['ArrowDown', { altKey: true }], ['F4']]) {
      const doc = opts(), s = doc.querySelector('select')
      s.focus()
      pressKey(s, key, init)
      expect(s.picker).toBe(1)
    }
    const doc = opts(), s = doc.querySelector('select'), ev = log(s, 'input', 'change')
    s.focus()
    pressKey(s, 'Enter')
    pressKey(s, 'ArrowDown')
    expect(s.picker).toBe(3)
    pressKey(s, 'Escape')
    expect([s.picker, s.value, ev]).toEqual([null, 'b', []])
    pressKey(s, ' ')
    pressKey(s, 'Home')
    pressKey(s, 'Enter')
    expect([s.picker, s.value, ev]).toEqual([null, 'a', ['input', 'change']])
  })
  it('closed: ← / → and a letter change it; the list closes when the focus leaves', () => {
    const doc = tree(['select', { value: 'a' }, ['option', { value: 'a' }, 'Apple'], ['option', { value: 'b' }, 'Banana'], ['option', { value: 'c' }, 'Avocado']], ['button', {}, 'x'])
    const s = doc.querySelector('select')
    s.focus()
    pressKey(s, 'ArrowRight')
    expect(s.value).toBe('b')
    pressKey(s, 'a')
    expect(s.value).toBe('c')
    s.showPicker()
    doc.querySelector('button').focus()
    expect(s.picker).toBe(null)
  })
})

describe('sygnal/host: focus order, radios, dialog, popover, details', () => {
  it('a radio group is one Tab stop; the arrows check the next radio', () => {
    const doc = tree(['input', { type: 'radio', name: 'p', value: 'l' }], ['input', { type: 'radio', name: 'p', value: 'm', checked: true }], ['input', { type: 'radio', name: 'p', value: 'h' }], ['button', {}, 'Go'])
    expect(focusableElements(doc).map((e) => e.value || e.localName)).toEqual(['m', 'button'])
    const [, m, hi] = doc.querySelectorAll('input')
    m.focus()
    const ev = log(hi, 'click', 'change')
    pressKey(m, 'ArrowDown')
    expect([doc.activeElement, hi.checked, m.checked, ev]).toEqual([hi, true, false, ['click', 'change']])
  })

  it('an explicit tabindex="-1" leaves an element the app listens to clicks on out of the Tab order (a roving tabindex)', async () => {
    const { term } = runApp(function Tabs({ state, uid }) {
      const a = tabsAttrs(state.t, uid)
      return h('div', null, h('div', a.list, ...['one', 'two'].map((v) => h('button', { className: 'tab', ...a.tab(v) }, v))), h('p', a.panel('one'), 'first'), h('p', a.panel('two'), 'second'))
    }, { uses: { t: tabs({ tab: '.tab', selected: 'one' }) } })
    await tick()
    expect(term.focusables().map((e) => e.textContent)).toEqual(['one', 'first'])
    term.focus('.tab')
    term.press('ArrowRight')
    await tick(40)
    expect(term.doc.activeElement.textContent).toBe('two')
    expect(term.frame()).toBe('[one] ▸[two]\nsecond')
  })

  it('<dialog>: showModal() moves the focus in, makes the rest inert, Escape sends cancel then close (a microtask later), the focus returns', async () => {
    const doc = tree(['button', { id: 'open' }, 'Open'], ['dialog', {}, ['p', {}, 'Sure?'], ['button', { id: 'ok' }, 'OK']])
    const open = doc.getElementById('open'), d = doc.querySelector('dialog')
    open.focus()
    expect(focusableElements(doc).map((e) => e.id)).toEqual(['open'])
    const ev = log(d, 'cancel', 'close')
    d.showModal()
    expect([d.open, d.modal, doc.activeElement.id, isInert(open)]).toEqual([true, true, 'ok', true])
    expect(focusableElements(doc).map((e) => e.id)).toEqual(['ok'])
    expect(() => d.showModal()).not.toThrow()
    pressKey(doc.activeElement, 'Escape')
    expect([d.open, doc.activeElement, ev]).toEqual([false, open, ['cancel']])
    await tick()
    expect(ev).toEqual(['cancel', 'close'])
    // closedby="none": Escape is the app's
    d.setAttribute('closedby', 'none')
    d.showModal()
    pressKey(doc.activeElement, 'Escape')
    expect(d.open).toBe(true)
    d.close('ok')
    expect(d.returnValue).toBe('ok')
  })

  it('invoker buttons: popovertarget toggles a popover, commandfor runs a command; Escape hides an auto popover', async () => {
    const { term } = runApp(() => h('div', null,
      h('button', { popovertarget: 'pop' }, 'Menu'), h('div', { id: 'pop', popover: 'auto' }, 'Popped'),
      h('button', { commandfor: 'dlg', command: 'show-modal' }, 'Ask'), h('dialog', { id: 'dlg' }, h('button', { commandfor: 'dlg', command: 'close', value: 'no' }, 'No'))))
    await tick()
    expect(term.frame()).toBe('[Menu] [Ask]')
    term.focus('[popovertarget]')
    term.press('Enter')
    expect(term.doc.getElementById('pop').popoverOpen).toBe(true)
    expect(term.frame()).toBe('▸[Menu] [Ask]\nPopped') // under its invoker, over the page
    term.press('Escape')
    expect(term.frame()).toBe('▸[Menu] [Ask]')
    term.focus('[command="show-modal"]')
    term.press('Enter')
    const d = term.doc.getElementById('dlg')
    expect(d.modal).toBe(true)
    term.press('Enter')
    expect([d.open, d.returnValue]).toEqual([false, 'no'])
  })

  it('a closed <details> shows its summary only; Enter on the summary opens it', async () => {
    const { term } = runApp(() => h('details', null, h('summary', null, 'More'), h('p', null, 'Hidden text'), h('button', null, 'In')))
    await tick()
    expect(term.frame()).toBe('▸ More')
    expect(term.focusables().map((e) => e.localName)).toEqual(['summary'])
    term.press('Tab')
    term.press('Enter')
    expect(term.frame()).toBe('▸▾ More\nHidden text\n[In]')
  })

  it('a dataset holds strings, as the DOM\'s; addEventListener honours once', () => {
    const doc = tree(['div'])
    const el = doc.querySelector('div')
    el.dataset.id = 7
    expect([el.dataset.id, el.getAttribute('data-id')]).toEqual(['7', '7'])
    let n = 0
    el.addEventListener('x', () => n++, { once: true })
    el.dispatchEvent(new HostEvent('x'))
    el.dispatchEvent(new HostEvent('x'))
    expect(n).toBe(1)
  })
})

function runApp(view, statics = {}) {
  Object.assign(view, statics)
  const term = createTerminal(statics.terminal || {})
  apps.push(run(view, { DOM: term.driver, TERMINAL: term.control, TIMER: makeTimerDriver() }))
  return { term }
}

describe('sygnal/terminal: boxes', () => {
  const page = (rules, width = 40, height) => (...nodes) => paint(tree(...nodes), { rules, width, height }).plain
  it('a flex row with sized items lays them out side by side, borders with titles, padding', () => {
    const p = page([
      ['.row', { display: 'flex' }],
      ['.a', { width: 12, border: 'single' }],
      ['.b', { flex: 1, border: 'round', padding: [0, 1] }],
    ])
    expect(p(['div', { class: 'row' }, ['ul', { class: 'a', 'aria-label': 'List' }, ['li', {}, 'one'], ['li', {}, 'two']], ['div', { class: 'b' }, 'Detail text that wraps inside its box']])).toEqual([
      '┌─ List ───┐ ╭─────────────────────────╮',
      '│• one     │ │ Detail text that wraps  │',
      '│• two     │ │ inside its box          │',
      '└──────────┘ ╰─────────────────────────╯',
    ])
  })

  it('a flex column with a height: the flex item takes the rows left, the footer is on the last row', () => {
    const p = page([['main', { display: 'flex', flexDirection: 'column', height: '100%' }], ['.body', { flex: 1 }]], 20, 5)
    expect(p(['main', {}, ['h1', {}, 'Head'], ['div', { class: 'body' }, 'text'], ['footer', {}, 'status']])).toEqual(['Head', 'text', '', '', 'status'])
  })

  it('overflow: auto scrolls with a scrollbar and keeps the focus in view; the wheel scrolls it, and it stays', async () => {
    const items = Array.from({ length: 10 }, (_, i) => h('li', { tabindex: '0', className: 'i' + i }, 'item ' + i))
    const { term } = runApp(() => h('ul', { className: 'list' }, ...items), { terminal: { styles: [['.list', { height: 4, overflow: 'auto', border: true }]], width: 14 } })
    await tick()
    expect(term.frame()).toBe('┌────────────┐\n│• item 0   █│\n│• item 1   ││\n└────────────┘')
    term.focus('.i6')
    expect(term.frame()).toBe('┌────────────┐\n│• item 5   ││\n│• ▸item 6  █│\n└────────────┘')
    expect(term.wheel(1, 3, -3)).toBe(true)
    expect(term.frame()).toBe('┌────────────┐\n│• item 2   █│\n│• item 3   ││\n└────────────┘')
    term.doc.querySelector('.i9').scrollIntoView()
    expect(term.frame()).toContain('item 9')
  })

  it("a web inline style's CSS lengths are not cells (sygnal/primitives' padding: 8 is '8px')", () => {
    const doc = tree(['div', {}, 'x'])
    doc.querySelector('div').style.padding = '8px'
    doc.querySelector('div').style.width = '100px'
    expect(paint(doc, { width: 20 }).plain).toEqual(['x'])
  })
})

describe('sygnal/terminal: cells, overlays, the caret', () => {
  it('emoji and CJK are two cells wide; combining marks none: wrapping and boxes line up', () => {
    expect([stringWidth('ab'), stringWidth('日本'), stringWidth('🐛'), stringWidth('👍🏽'), stringWidth('é'), stringWidth('é')]).toEqual([2, 4, 2, 2, 1, 1])
    const f = paint(tree(['div', { class: 'b' }, '🐛 bug 日本語のテキスト']), { width: 12, rules: [['.b', { border: true }]] })
    expect(f.plain).toEqual(['┌──────────┐', '│🐛 bug    │', '│日本語のテ│', '│キスト    │', '└──────────┘'])
  })

  it('emojiWidth: 1 for a terminal on the older width tables (xterm.js by default): the borders still line up', () => {
    expect([stringWidth('🐛', 1), stringWidth('日本', 1)]).toEqual([1, 4]) // CJK stays 2
    const f = paint(tree(['div', { class: 'b' }, '🐛 bug']), { width: 9, emojiWidth: 1, rules: [['.b', { border: true }]] })
    expect(f.plain).toEqual(['┌───────┐', '│🐛 bug  │', '└───────┘'])
  })

  it('a modal dialog is drawn centered over the page (dimmed in ANSI); the open <select> list under its select', () => {
    const doc = tree(['p', {}, 'Page text'], ['select', { value: 'b' }, ['option', { value: 'a' }, 'Alpha'], ['option', { value: 'b' }, 'Beta']], ['dialog', { 'aria-label': 'Ask' }, 'Sure?'])
    const s = doc.querySelector('select')
    s.focus()
    s.showPicker()
    expect(paint(doc, { width: 30, height: 6 }).plain).toEqual(['Page text', '▸[Beta ▴]', '┌────────┐', '│ Alpha  │', '│▸Beta  ✓│', '└────────┘'])
    doc.querySelector('dialog').showModal()
    const f = paint(doc, { width: 30, height: 6 })
    // (the dialog has the focus: nothing in it is focusable; a focused box's border is heavy)
    expect(f.plain).toEqual(['Page text', '[Beta ▾]  ┏━ Ask ━┓', '          ┃ Sure? ┃', '          ┗━━━━━━━┛', '', ''])
    expect(f.ansi[0]).toBe('\x1b[2mPage text\x1b[0m')
  })

  it('a focused field: the caret cell inverse (in plain text, _ at the end); a selection inverse; frame.caret is where', () => {
    const doc = tree(['input', { value: 'abcd' }])
    const el = doc.querySelector('input')
    el.focus()
    let f = paint(doc)
    expect([f.plain[0], f.caret]).toEqual(['▸[abcd_]', { line: 0, col: 6 }])
    el.setSelectionRange(1, 1)
    f = paint(doc)
    expect([f.plain[0], f.caret, f.ansi[0]]).toEqual(['▸[abcd]', { line: 0, col: 3 }, '▸[\x1b[4ma\x1b[0m\x1b[7mb\x1b[0m\x1b[4mcd\x1b[0m]'])
    el.setSelectionRange(1, 3)
    expect(paint(doc).ansi[0]).toContain('\x1b[7mbc\x1b[0m')
  })
})

describe('sygnal/terminal: input', () => {
  it('parses modified keys, Alt+key, bracketed paste and SGR mouse events', () => {
    expect(parseKeys('\x1b[1;5C\x1b[1;2D\x1b[3;3~\x1bb\x1b[200~two\r\nlines\x1b[201~\x1b[<0;5;3M\x1b[<0;5;3m\x1b[<65;1;1M')).toEqual([
      { key: 'ArrowRight', ctrlKey: true }, { key: 'ArrowLeft', shiftKey: true }, { key: 'Delete', altKey: true }, { key: 'b', altKey: true },
      { key: 'Paste', text: 'two\nlines' },
      { key: 'Mouse', x: 4, y: 2, button: 0, release: false }, { key: 'Mouse', x: 4, y: 2, button: 0, release: true },
      { key: 'Mouse', x: 0, y: 0, button: 'down', release: false },
    ])
  })

  it('clicks: a checkbox toggles, a button clicks, a select opens and an option chooses, an input gets the caret', async () => {
    const { Box, Go, Pick, Name } = controls({ Box: 'input', Go: 'button', Pick: 'select', Name: 'input' })
    function App({ state }) {
      return h('div', null, h(Box, { type: 'checkbox', checked: state.on }), h(Go, null, 'Go ' + state.n),
        h(Pick, { value: state.pick }, h('option', { value: 'x' }, 'Ex'), h('option', { value: 'y' }, 'Why')), h(Name, { value: 'hello' }))
    }
    App.initialState = { on: false, n: 0, pick: 'x' }
    App.intent = ({ DOM }) => ({ ON: DOM.change(Box).checked(), GO: DOM.click(Go), PICK: DOM.change(Pick).value() })
    App.model = { ON: (s, on) => ({ ...s, on }), GO: (s) => ({ ...s, n: s.n + 1 }), PICK: (s, pick) => ({ ...s, pick }) }
    const { term } = runApp(App)
    await tick()
    expect(term.frame()).toBe('[ ] [Go 0] [Ex ▾] [hello]')
    term.click(0, 1)
    term.click(0, 6)
    await tick()
    expect(term.frame()).toBe('[x] ▸[Go 1] [Ex ▾] [hello]')
    term.click(0, 13)
    expect(term.frame()).toBe('[x] [Go 1] ▸[Ex ▴] [hello]\n           ┌───────┐\n           │▸Ex   ✓│\n           │ Why   │\n           └───────┘')
    expect(hitTest(term.render(), 3, 14).textContent).toBe('Why')
    term.click(3, 14)
    await tick()
    expect(term.frame()).toBe('[x] [Go 1] ▸[Why ▾] [hello]')
    term.click(0, 23)
    expect([term.doc.activeElement.value, term.doc.activeElement.selectionStart]).toEqual(['hello', 2])
  })

  it('readline keys in a field (Ctrl+A / E / K / U / W, Alt+B / F); an app keymap can take them first', async () => {
    const { term } = runApp(() => h('input', { value: 'one two three' }))
    await tick()
    term.focus('input')
    const el = term.doc.activeElement
    term.press('a', { ctrlKey: true })
    expect(el.selectionStart).toBe(0)
    term.press('f', { altKey: true })
    term.press('k', { ctrlKey: true })
    expect(el.value).toBe('one')
    term.press('e', { ctrlKey: true })
    term.type(' four')
    term.press('w', { ctrlKey: true })
    expect(el.value).toBe('one ')
    term.press('u', { ctrlKey: true })
    expect(el.value).toBe('')
  })

  it('the key hint follows the focus; the TERMINAL sink records commands', async () => {
    const { Quit } = controls({ Quit: 'button' })
    function App() { return h('div', null, h('select', null, h('option', null, 'a')), h(Quit, null, 'Quit')) }
    App.intent = ({ DOM }) => ({ QUIT: DOM.click(Quit) })
    App.initialState = {}
    App.model = { QUIT: { TERMINAL: () => ({ title: 'bye' }) } }
    const { term } = runApp(App)
    await tick()
    expect(term.keyHint()).toBe('Tab move · Ctrl+C quit')
    term.focus('select')
    expect(term.keyHint()).toBe('Enter open list · ←/→ change · Ctrl+C quit')
    term.press('Tab')
    term.press('Enter')
    await tick()
    expect(term.commands).toEqual([{ title: 'bye' }])
  })
})

describe('sygnal/terminal: the ui parts that work in a terminal', () => {
  it('disclosure and accordion (↑ / ↓ move between the triggers)', async () => {
    function Faq({ state, uid }) {
      const a = accordionAttrs(state.faq, uid), d = disclosureAttrs(state.more, uid)
      return h('div', null, ...['a', 'b'].flatMap((v) => [h('button', { className: 'q', ...a.trigger(v) }, 'Q' + v), h('p', a.panel(v), 'A' + v)]),
        h('button', { className: 'more', ...d.trigger }, 'More'), h('p', d.panel, 'Details'))
    }
    const { term } = runApp(Faq, { uses: { faq: accordion({ trigger: '.q' }), more: disclosure({ trigger: '.more' }) } })
    await tick()
    expect(term.frame()).toBe('[Qa] [Qb] [More]')
    term.focus('.q')
    term.press('Enter')
    await tick()
    expect(term.frame()).toBe('▸[Qa]\nAa\n[Qb] [More]')
    term.press('ArrowDown')
    await tick(40)
    expect(term.doc.activeElement.textContent).toBe('Qb')
    term.focus('.more')
    term.press(' ')
    await tick()
    expect(term.frame()).toBe('[Qa]\nAa\n[Qb] ▸[More]\nDetails')
  })

  it('popover (a popovertarget button) and tooltip (on focus)', async () => {
    function P({ state, uid }) {
      return h('div', null, h('button', { popovertarget: uid('f') }, 'Filters'), h('div', { className: 'f', id: uid('f'), popover: 'auto' }, h('button', { className: 'done' }, 'Done')),
        h('button', { className: 'save', 'aria-describedby': uid('tip') }, 'Save'), h('div', { className: 'tip', id: uid('tip'), role: 'tooltip', popover: 'manual' }, 'Saves it'),
        h('p', null, 'open: ' + state.filters.open))
    }
    const { term } = runApp(P, { uses: { filters: popover({ popover: '.f', close: '.done' }), tip: tooltip({ trigger: '.save', tip: '.tip', showDelay: 0 }) } })
    await tick()
    term.press('Tab')
    term.press('Enter')
    await tick()
    // the top layer: drawn over the page under its invoker (here over the "open:" line)
    expect(term.frame()).toBe('▸[Filters] [Save]\n[Done]true')
    term.press('Escape')
    await tick()
    expect(term.frame()).toBe('▸[Filters] [Save]\nopen: false')
    term.press('Tab')
    await tick(20)
    expect(term.frame()).toBe('[Filters] ▸[Save]\nopen: falsSaves it') // the tooltip, on focus: under its trigger
  })
})

describe('runTerminal', () => {
  function tty(cols = 30, rows = 6) {
    const stdin = Object.assign(new EventEmitter(), { isTTY: true, setRawMode(on) { this.raw = on }, setEncoding() {}, resume() {}, pause() {} })
    const out = []
    const stdout = Object.assign(new EventEmitter(), { isTTY: true, columns: cols, rows, write: (s) => out.push(s) })
    return { stdin, stdout, out }
  }
  it('mouse mode on request, a paste split across chunks, and the terminal restored on stop', async () => {
    const { stdin, stdout, out } = tty()
    const { terminal, stop } = runTerminal(() => h('input', { className: 'f' }), { stdin, stdout, mouse: true, color: false })
    expect(out[0]).toBe('\x1b[?1049h\x1b[?25l\x1b[?2004h\x1b[?1000h\x1b[?1002h\x1b[?1006h')
    expect(stdin.raw).toBe(true)
    await tick()
    terminal.focus('.f')
    stdin.emit('data', '\x1b[200~hello ')
    stdin.emit('data', 'world\x1b[201~')
    expect(terminal.doc.activeElement.value).toBe('hello world')
    stop()
    expect(out.at(-1)).toBe('\x1b[?1006l\x1b[?1002l\x1b[?1000l\x1b[?2004l\x1b[?25h\x1b[?1049l')
    expect(stdin.raw).toBe(false)
  })

  it("asks the terminal how wide it draws an emoji (a cursor position report), and repaints with it", async () => {
    const { stdin, stdout, out } = tty(20, 4)
    const { terminal, stop } = runTerminal(() => h('p', null, '🐛 x'), { stdin, stdout, color: false, footer: false })
    expect(out).toContain('\x1b[H\u{1F41B}\x1b[6n')
    expect(terminal.emojiWidth).toBe(2)
    await tick()
    stdin.emit('data', '\x1b[1;2R') // the cursor is in column 2: one cell
    expect(terminal.emojiWidth).toBe(1)
    stop()
    const fixed = tty()
    runTerminal(() => h('p', null, 'x'), { ...fixed, emojiWidth: 1 }).stop()
    expect(fixed.out.some((x) => x.includes('\x1b[6n'))).toBe(false)
  })

  it("a fixed layout fills the screen: the app's rows, then the key hint", async () => {
    const { stdin, stdout, out } = tty(20, 5)
    const { stop } = runTerminal(() => h('main', null, h('p', null, 'top'), h('footer', null, 'bar')), {
      stdin, stdout, color: false, styles: [['main', { display: 'flex', flexDirection: 'column', height: '100%' }], ['p', { flex: 1 }]],
    })
    await tick()
    expect(out.at(-1)).toBe('\x1b[?2026h\x1b[Htop\x1b[K\r\n\x1b[K\r\n\x1b[K\r\nbar\x1b[K\r\nTab move · Ctrl+C quit\x1b[K\x1b[J\x1b[?2026l')
    stop()
  })
})
