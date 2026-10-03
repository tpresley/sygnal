// @vitest-environment jsdom
// G-146: a controlled input keeps every keystroke of fast typing. A render built from a state
// older than the text the user has typed since must not write that older value back.
// Gap-study experiment X2b: 'Hello world' typed with user-event at 0-1 ms per key became
// 'Hlowrd'. Here keys are typed the way a browser does: the value changes, then `input`.
import { describe, it, expect, afterEach } from 'vitest'
import { renderComponent } from '../src/extra/testing.js'
import { createElement as h } from '../src/pragma/index.js'
import { Collection } from '../src/index.js'

let t
afterEach(() => { if (t) t.dispose(); t = null; document.body.innerHTML = '' })

const tick = (ms) => new Promise(r => setTimeout(r, ms))
async function type(el, text, delay) {
  for (const ch of text) {
    el.value += ch
    el.dispatchEvent(new Event('input', { bubbles: true }))
    await tick(delay)
  }
}

function F({ state }) {
  return h('div', null,
    h('input', { className: 'draft', value: state.draft }),
    h('textarea', { className: 'notes', value: state.notes }),
    h('button', { className: 'clear' }, 'clear'),
    h('button', { className: 'shout' }, 'shout'),
    h('p', { className: 'echo' }, state.draft))
}
F.initialState = { draft: '', notes: '' }
F.intent = ({ DOM }) => ({
  DRAFT: DOM.input('.draft').value(),
  NOTES: DOM.input('.notes').value(),
  CLEAR: DOM.click('.clear'),
  SHOUT: DOM.click('.shout'),
})
F.model = {
  DRAFT: (s, draft) => ({ ...s, draft }),
  NOTES: (s, notes) => ({ ...s, notes }),
  CLEAR: (s) => ({ ...s, draft: null }),
  SHOUT: (s) => ({ ...s, draft: s.draft.toUpperCase() }),
}

describe('G-146: controlled inputs keep fast keystrokes', () => {
  for (const delay of [0, 1, 2, 3, 5]) {
    it(`input and textarea keep every key at ${delay} ms per key`, async () => {
      t = renderComponent(F, { dom: 'real' }); await t.ready()
      await type(t.query('.draft'), 'Hello world', delay)
      await type(t.query('.notes'), 'fast notes', delay)
      await t.settle()
      expect(t.query('.draft').value).toBe('Hello world')
      expect(t.state.draft).toBe('Hello world')
      expect(t.query('.notes').value).toBe('fast notes')
      expect(t.query('.echo').textContent).toBe('Hello world')
    })
  }

  it('a slow view (8 ms) with keys 5 ms apart keeps every key', async () => {
    function Slow({ state }) {
      const end = performance.now() + 8; while (performance.now() < end) {}
      return h('input', { className: 's', value: state.s })
    }
    Slow.initialState = { s: '' }
    Slow.intent = ({ DOM }) => ({ S: DOM.input('.s').value() })
    Slow.model = { S: (st, s) => ({ ...st, s }) }
    t = renderComponent(Slow, { dom: 'real' }); await t.ready()
    await type(t.query('.s'), 'slow app here', 5)
    await t.settle()
    expect(t.query('.s').value).toBe('slow app here')
  })

  it('value={null} still clears the field and programmatic changes still update it', async () => {
    t = renderComponent(F, { dom: 'real' }); await t.ready()
    await type(t.query('.draft'), 'abc', 0)
    await t.settle()
    t.simulateEvent('.shout', 'click'); await t.settle()
    expect(t.query('.draft').value).toBe('ABC')
    t.simulateEvent('.clear', 'click'); await t.settle()
    expect(t.query('.draft').value).toBe('')
    t.simulateEvent('.draft', 'input', { value: 'x' }); await t.settle()
    expect(t.query('.draft').value).toBe('x')
  })

  it('a model that rewrites the typed text wins once it renders', async () => {
    function Upper({ state }) { return h('input', { className: 'u', value: state.v }) }
    Upper.initialState = { v: '' }
    Upper.intent = ({ DOM }) => ({ V: DOM.input('.u').value() })
    Upper.model = { V: (s, v) => ({ ...s, v: v.toUpperCase().slice(0, 4) }) }
    t = renderComponent(Upper, { dom: 'real' }); await t.ready()
    await type(t.query('.u'), 'abcdef', 0)
    await t.settle()
    expect(t.query('.u').value).toBe('ABCD')
  })

  it('a value reset right after typing (B-004) still lands', async () => {
    function Chat({ state }) { return h('form', null, h('input', { className: 'm', value: state.m }), h('button', { className: 'send' }, 'send')) }
    Chat.initialState = { m: '', sent: [] }
    Chat.intent = ({ DOM }) => ({ M: DOM.input('.m').value(), SEND: DOM.click('.send') })
    Chat.model = { M: (s, m) => ({ ...s, m }), SEND: (s) => ({ ...s, m: '', sent: [...s.sent, s.m] }) }
    t = renderComponent(Chat, { dom: 'real' }); await t.ready()
    await type(t.query('.m'), 'hi there', 0)
    t.query('.send').click()
    await t.settle()
    expect(t.state.sent).toEqual(['hi there'])
    expect(t.query('.m').value).toBe('')
  })

  it('inputs in Collection items keep fast keystrokes', async () => {
    function Row({ state }) { return h('li', null, h('input', { className: 'name', attrs: { 'data-id': state.id }, value: state.name })) }
    Row.intent = ({ DOM }) => ({ NAME: DOM.input('.name').value() })
    Row.model = { NAME: (s, name) => ({ ...s, name }) }
    function Rows() { return h('ul', null, h(Collection, { of: Row, from: 'rows' })) }
    Rows.initialState = { rows: [{ id: 'a', name: '' }, { id: 'b', name: '' }] }
    t = renderComponent(Rows, { dom: 'real' }); await t.ready()
    await type(t.query('.name[data-id="b"]'), 'quick brown', 0)
    await t.settle()
    expect(t.query('.name[data-id="b"]').value).toBe('quick brown')
    expect(t.state.rows[1].name).toBe('quick brown')
  })
})
