// @vitest-environment jsdom
import {describe, it, expect} from 'vitest'
import {renderComponent} from 'sygnal'
import {controlled} from '../../../../src/extra/controlled'
import {Notes} from '../app/Notes'

describe('controlled(): the protocol alone', () => {
  // the app's state lags the widget (a worker renderer, the RN bridge, an async model): the props
  // arrive after the user has typed on
  const lagging = (impl: 'naive' | 'protocol') => {
    let text = ''
    const writes: string[] = []
    const write = (v: string) => { text = v; writes.push(v) }
    const c = controlled(write)
    const naive = (v: string) => { if (v !== text) write(v) }
    const prop = impl == 'naive' ? naive : (v: string) => c.prop(v)
    const type = (v: string) => { text = v; c.local(v) }
    prop('')
    type('a'); type('ab'); type('abc')
    prop('a')    // late echoes of the first two keystrokes
    type('abcd')
    prop('ab'); prop('abc'); prop('abcd')
    return {text, writes}
  }
  it('naive "write when different" loses keystrokes', () => {
    const r = lagging('naive')
    expect(r.writes).toEqual(['a', 'ab', 'abc', 'abcd'])   // each one reset the field mid-typing
  })
  it('the protocol skips echoes, late ones included', () => {
    expect(lagging('protocol')).toEqual({text: 'abcd', writes: []})
  })
  it("the app's own values win; an unchanged prop never overwrites", () => {
    let text = ''
    const c = controlled((v: string) => { text = v })
    c.prop('')
    text = 'hello'; c.local('hello')
    c.prop('')                              // the prop didn't change (a re-render for something else)
    expect(text).toBe('hello')
    c.prop('HELLO')                         // a transform by the app
    expect(text).toBe('HELLO')
    c.prop('')                              // a reset
    expect(text).toBe('')
    expect(c.st.writes).toBe(2)
  })
})

// the widget's record on its host: the instance (the EditorView) and the controlled value's counts
const editorOf = (t: any) => { const r = t.container.querySelector('.code').__sw; return {view: r.i, c: {stats: r.c.st}} }
const typeAt = (ed: any, pos: number, insert: string) => ed.view.dispatch({changes: {from: pos, insert}, selection: {anchor: pos + insert.length}, userEvent: 'input.type'})
const macrotask = () => new Promise(r => setTimeout(r, 0))

describe('<Editor>: CodeMirror with a controlled value (jsdom)', () => {
  it('typing: state follows, nothing is written back, the cursor stays', async () => {
    const t = renderComponent(Notes, {dom: 'real'})
    await t.ready()
    const ed = editorOf(t)
    expect(ed.view.state.doc.toString()).toBe('hello')
    typeAt(ed, 5, ' w'); typeAt(ed, 7, 'o'); typeAt(ed, 8, 'rld')
    await t.waitForState((s: any) => s.text == 'hello world')
    await t.settle()
    expect(t.container.querySelector('.count').textContent).toBe('11 / 20')
    expect(ed.c.stats.writes).toBe(0)
    expect(t.state.edits).toBe(3)                  // one action per edit, no echo events
    expect(ed.view.state.selection.main.head).toBe(11)
    t.dispose()
  })

  it("the app's values: a reset and a clamp are written once, with no change event", async () => {
    const t = renderComponent(Notes, {dom: 'real'})
    await t.ready()
    const ed = editorOf(t)
    t.simulateEvent('.reset', 'click')
    await t.waitForState((s: any) => s.text == '')
    await t.settle()
    expect(ed.view.state.doc.toString()).toBe('')
    expect(ed.c.stats.writes).toBe(1)
    typeAt(ed, 0, 'a very long line that goes on')
    await t.waitForState((s: any) => s.text == 'a very long line tha')
    await t.settle()
    expect(ed.view.state.doc.toString()).toBe('a very long line tha')
    expect(ed.c.stats.writes).toBe(2)
    expect(t.state.edits).toBe(1)
    t.dispose()
  })

  it('strict: an edit the model rejected is reverted after its turn', async () => {
    const t = renderComponent(Notes, {dom: 'real'})
    await t.ready()
    const ed = editorOf(t)
    typeAt(ed, 5, '1')
    expect(ed.view.state.doc.toString()).toBe('hello1')
    await t.settle()
    await macrotask()
    expect(ed.view.state.doc.toString()).toBe('hello')
    expect(ed.c.stats.reverts).toBe(1)
    expect(t.state.text).toBe('hello')
    t.dispose()
  })
})
