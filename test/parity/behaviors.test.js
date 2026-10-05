// @vitest-environment jsdom
// PLAN-4.6 parity: behaviors (`uses`: undo) — the next core applies them through transformDef
// (spike 0-S §7, ported to the public API).
import { it, expect } from 'vitest'
import { parity, mount, h, click, until, Collection, undo } from './harness.js'

parity('parity: undo through `uses`', () => {
  function Editor({ state }) {
    return h('div', null, h('button', { className: 'add' }, '+'),
      h('button', { className: 'undo', disabled: !state.history.canUndo }, 'u'), h('button', { className: 'redo', disabled: !state.history.canRedo }, 'r'),
      h('p', { className: 'out' }, `${state.doc}|${state.history.past.length}|${state.history.future.length}`))
  }
  Editor.initialState = { doc: '' }
  Editor.uses = { history: undo({ key: 'doc', undo: '.undo', redo: '.redo' }) }
  Editor.intent = ({ DOM }) => ({ ADD: DOM.click('.add') })
  Editor.model = { ADD: (s) => ({ ...s, doc: s.doc + 'a' }) }

  it('state.history with canUndo / canRedo; the controls trigger history.UNDO / history.REDO; the static model is not mutated', async () => {
    const model = Editor.model
    const m = mount(Editor)
    await until(() => expect(m.text('.out')).toBe('|0|0'))
    click(m.$('.add')); click(m.$('.add')); click(m.$('.add'))
    await until(() => expect(m.text('.out')).toBe('aaa|3|0'))
    expect(m.state().history.canUndo).toBe(true)
    click(m.$('.undo')); click(m.$('.undo'))
    await until(() => expect(m.text('.out')).toBe('a|1|2'))
    click(m.$('.redo'))
    await until(() => expect(m.text('.out')).toBe('aa|2|1'))
    expect(Editor.model).toBe(model)
    expect(Object.keys(Editor.model)).toEqual(['ADD'])
  })

  it('as a Collection item: each item its own history', async () => {
    function Note({ state }) { return h('li', { className: 'note' }, h('button', { className: 'add' }, '+'), h('button', { className: 'undo' }, 'u'), `${state.doc}:${state.history.past.length}`) }
    Note.uses = { history: undo({ key: 'doc', undo: '.undo' }) }
    Note.intent = ({ DOM }) => ({ ADD: DOM.click('.add') })
    Note.model = { ADD: (s) => ({ ...s, doc: s.doc + 'x' }) }
    function L() { return h('ul', null, h(Collection, { of: Note, from: 'notes' })) }
    L.initialState = { notes: [{ id: 1, doc: 'a' }, { id: 2, doc: 'b' }] }
    const m = mount(L)
    const notes = () => m.$$('.note').map((e) => e.textContent.replace('+u', ''))
    await until(() => expect(notes()).toEqual(['a:0', 'b:0']))
    click(m.$$('.note .add')[1]); click(m.$$('.note .add')[1])
    await until(() => expect(notes()).toEqual(['a:0', 'bxx:2']))
    click(m.$$('.note .undo')[1])
    await until(() => expect(notes()).toEqual(['a:0', 'bx:1']))
    expect(m.state().notes[0]).toMatchObject({ id: 1, doc: 'a' })
  })
}, 'R3')
