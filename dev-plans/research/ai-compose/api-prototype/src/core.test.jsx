// Empirical core behaviours a composed UI relies on (no compose library involved): plain Sygnal
// components chosen at run time from a registry, rendered by the host's own view.
import { describe, it, expect, afterEach } from 'vitest'
import { renderComponent, Collection, ABORT } from 'sygnal'

let t
afterEach(() => t?.dispose())

const names = (g, name) => g.components.filter((c) => c.name === name)

// a part with LOCAL state (isolatedState, no state= prop): its count only survives if the instance does
function Counter({ state, label }) {
  return <div className="counter" data={{ label }}><span className="n">{label}:{state.n}</span><button className="inc">+</button></div>
}
Counter.isolatedState = true
Counter.initialState = { n: 0 }
Counter.intent = ({ DOM }) => ({ INC: DOM.click('.inc') })
Counter.model = { INC: (s) => ({ ...s, n: s.n + 1 }) }

// a part with app state through a lens, telling the host about clicks (PARENT)
function Note({ state, node }) {
  return <p className="note" data={{ node }}>{state.text}<button className="pick">pick</button></p>
}
Note.intent = ({ DOM }) => ({ PICK: DOM.click('.pick') })
Note.model = { PICK: { PARENT: (s, _d, _n, props) => ({ node: props.node, text: s.text }) } }

const REGISTRY = { counter: Counter, note: Note }

describe('core: composed parts', () => {
  it('renders a component chosen at run time; CHILD.select(Comp) hears it; several instances use different lenses', async () => {
    function Host({ state }) {
      return (
        <main>
          <p className="picked">{state.picked}</p>
          {state.layout.map((n) => {
            const C = REGISTRY[n.part]
            const lens = n.record != null
              ? { get: (s) => s.notes.find((x) => x.id === n.record), set: (s, v) => ({ ...s, notes: s.notes.map((x) => (x.id === n.record ? v : x)) }) }
              : undefined
            return <section className="slot" data={{ key: n.key }}><C id={n.key} node={n.key} state={lens} /></section>
          })}
        </main>
      )
    }
    Host.initialState = {
      picked: '',
      notes: [{ id: 1, text: 'one' }, { id: 2, text: 'two' }],
      layout: [{ key: 'a', part: 'note', record: 1 }, { key: 'b', part: 'note', record: 2 }],
    }
    Host.intent = ({ CHILD }) => ({ PICKED: CHILD.select(Note) })
    Host.model = { PICKED: (s, { node, text }) => ({ ...s, picked: `${node}=${text}` }) }

    t = renderComponent(Host, { strict: true })
    await t.ready()
    expect(t.html()).toContain('one')
    expect(t.html()).toContain('two')
    t.simulateEvent('.note[data-node="b"] .pick', 'click')
    await t.next((s) => s.picked === 'b=two')
    expect(names(t.inspect(), 'Note')).toHaveLength(2)
    t.expectNoDiagnostics()
  })

  it('keeps an instance (local state) when it moves between plain-element containers and siblings reorder, with id={nodeKey}', async () => {
    // containers are plain elements produced by the host view (a recursive function), so every part is a kid of the host
    const box = (cls, keys) => <div className={cls}>{keys.map((k) => <Counter id={k} label={k} />)}</div>
    function Host({ state }) {
      return <main><button className="move">move</button>{box('left', state.left)}{box('right', state.right)}</main>
    }
    Host.initialState = { left: ['a', 'b'], right: ['c'] }
    Host.intent = ({ DOM }) => ({ MOVE: DOM.click('.move') })
    // a moves to the right column, at the end; b and c swap order relative to each other
    Host.model = { MOVE: (s) => ({ ...s, left: ['b'], right: ['c', 'a'] }) }

    t = renderComponent(Host)
    await t.ready()
    t.simulateEvent('.counter[data-label="a"] .inc', 'click')
    t.simulateEvent('.counter[data-label="a"] .inc', 'click')
    t.simulateEvent('.counter[data-label="c"] .inc', 'click')
    await t.settle()
    expect(t.query('.counter[data-label="a"] .n').textContent).toBe('a:2')
    t.simulateEvent('.move', 'click')
    await t.next((s) => s.right.length === 2)
    expect(t.html()).toMatch(/class="right".*c:1.*a:2/)
    expect(t.query('.counter[data-label="a"] .n').textContent).toBe('a:2')   // survived the move
    expect(names(t.inspect(), 'Counter')).toHaveLength(3)
  })

  it('WITHOUT an id the instance is keyed by its path: a move re-creates it (local state lost)', async () => {
    function Host({ state }) {
      return <main><button className="move">move</button><div className="left">{state.left.map((k) => <Counter label={k} />)}</div><div className="right">{state.right.map((k) => <Counter label={k} />)}</div></main>
    }
    Host.initialState = { left: ['a'], right: [] }
    Host.intent = ({ DOM }) => ({ MOVE: DOM.click('.move') })
    Host.model = { MOVE: (s) => ({ ...s, left: [], right: ['a'] }) }
    t = renderComponent(Host)
    await t.ready()
    t.simulateEvent('.inc', 'click')
    await t.settle()
    expect(t.query('.n').textContent).toBe('a:1')
    t.simulateEvent('.move', 'click')
    await t.next((s) => s.right.length === 1)
    expect(t.query('.n').textContent).toBe('a:0')
  })

  it('a container that is a COMPONENT owns its slot children: moving a part between two such containers re-creates it, and the host CHILD.select does not hear it', async () => {
    function Column({ children, title }) { return <div className={`col ${title}`}>{children}</div> }
    function Host({ state }) {
      return (
        <main>
          <p className="picked">{state.picked}</p>
          <button className="move">move</button>
          <Column id="left" title="left">{state.left.map((k) => <Counter id={k} label={k} />)}</Column>
          <Column id="right" title="right">{state.right.map((k) => <Counter id={k} label={k} />)}<Note id="n" node="n" state="note" /></Column>
        </main>
      )
    }
    Host.initialState = { left: ['a'], right: [], picked: '', note: { text: 'hi' } }
    Host.intent = ({ DOM, CHILD }) => ({ MOVE: DOM.click('.move'), PICKED: CHILD.select(Note) })
    Host.model = { MOVE: (s) => ({ ...s, left: [], right: ['a'] }), PICKED: (s, d) => ({ ...s, picked: d.node }) }
    t = renderComponent(Host)
    await t.ready()
    t.simulateEvent('.inc', 'click')
    await t.settle()
    expect(t.query('.n').textContent).toBe('a:1')
    const g = t.inspect()
    const col = g.components.find((c) => c.name === 'Column')
    expect(names(g, 'Counter')[0].parentId).toBe(col.id)   // owned by the Column, not the Host
    t.simulateEvent('.move', 'click')
    await t.next((s) => s.right.length === 1)
    expect(t.query('.n').textContent).toBe('a:0')          // re-created in the other Column
    t.simulateEvent('.pick', 'click')
    await t.settle()
    expect(t.state.picked).toBe('')                         // a grandchild's PARENT stops at the Column
  })

  it('a composed part can hold a Collection, read context, and send its own HTTP request (the reply reaches it)', async () => {
    function Item({ state }) { return <li className="item">{state.title}<button className="done">x</button></li> }
    Item.intent = ({ DOM }) => ({ DONE: DOM.click('.done') })
    Item.model = { DONE: () => undefined }
    function Orders({ state, context }) {
      return (
        <div className="orders">
          <h4 className="who">{context.user} / {context.currency}</h4>
          <ul><Collection of={Item} from="items" /></ul>
          <button className="load">load</button><span className="total">{state.total}</span>
        </div>
      )
    }
    Orders.intent = ({ DOM }) => ({ LOAD: DOM.click('.load') })
    Orders.model = {
      LOAD: { HTTP: () => ({ url: '/api/total', ok: 'TOTAL', error: 'FAILED' }) },
      TOTAL: (s, body) => ({ ...s, total: body.total }),
      FAILED: (s) => s,
    }
    const PARTS = { orders: Orders }
    function Host({ state }) {
      return <main>{state.layout.map((n) => { const C = PARTS[n.part]; return <C id={n.key} state={n.state} /> })}</main>
    }
    Host.initialState = { user: 'ann', layout: [{ key: 'o1', part: 'orders', state: 'orders' }], orders: { total: 0, items: [{ id: 1, title: 'A' }, { id: 2, title: 'B' }] } }
    Host.context = { user: (s) => s.user, currency: () => 'EUR' }
    t = renderComponent(Host, { strict: true })
    await t.ready()
    expect(t.query('.who').textContent).toBe('ann / EUR')
    t.simulateEvent('.item:first-child .done', 'click')
    await t.next((s) => s.orders.items.length === 1)
    t.simulateEvent('.load', 'click')
    await t.respond('HTTP', { total: 42 }, 'TOTAL')
    expect(t.state.orders.total).toBe(42)
    t.expectNoDiagnostics()
  })

  it('changing which component a node key renders disposes the old instance (k.def.view !== view)', async () => {
    function Other() { return <p className="other">other</p> }
    function Host({ state }) { const C = state.which === 'c' ? Counter : Other; return <main><button className="swap">s</button><C id="n1" label="x" /></main> }
    Host.initialState = { which: 'c' }
    Host.intent = ({ DOM }) => ({ SWAP: DOM.click('.swap') })
    Host.model = { SWAP: (s) => ({ ...s, which: s.which === 'c' ? 'o' : 'c' }) }
    t = renderComponent(Host)
    await t.ready()
    t.simulateEvent('.inc', 'click')
    await t.settle()
    t.simulateEvent('.swap', 'click'); await t.next((s) => s.which === 'o')
    t.simulateEvent('.swap', 'click'); await t.next((s) => s.which === 'c')
    expect(t.query('.n').textContent).toBe('x:0')
  })
})

void ABORT
