// Regression tests for PLAN-1 workstream 1G (rendering/state bug fixes), real DOM.
import { run, Collection } from 'sygnal'
import { mount, assert, runTest, wait, waitFor } from '../harness.js'

const CAT = 'Bug fixes (1G)'

const texts = (el, sel) => [...el.querySelectorAll(sel)].map(n => n.textContent).join(',')

export async function bugfixTests1G() {
  // ─── B-010: a Collection follows a pure reorder of its array ─────────────
  function Row({ state }) {
    return <li className="row">
      <input type="checkbox" className="done" checked={state.done} />
      <span className="name">{state.name}</span>
      <span className="clicks">{state.clicks}</span>
      <button className="bump">+</button>
    </li>
  }
  Row.intent = ({ DOM }) => ({ BUMP: DOM.click('.bump'), TOGGLE: DOM.select('.done').events('change') })
  Row.model = {
    BUMP: s => ({ ...s, clicks: s.clicks + 1 }),
    TOGGLE: s => ({ ...s, done: !s.done }),
  }

  const move = (arr, from, to) => { const a = arr.slice(); const [x] = a.splice(from, 1); a.splice(to, 0, x); return a }

  function ReorderApp({ state }) {
    return <div>
      <button className="reverse">Reverse</button>
      <button className="swap">Swap</button>
      <button className="last-first">Last first</button>
      <ul><Collection of={Row} from="items" /></ul>
    </div>
  }
  ReorderApp.initialState = {
    items: ['a', 'b', 'c', 'd'].map((name, i) => ({ id: i + 1, name, clicks: 0, done: false })),
  }
  ReorderApp.intent = ({ DOM }) => ({
    REVERSE: DOM.click('.reverse'),
    SWAP: DOM.click('.swap'),
    LAST_FIRST: DOM.click('.last-first'),
  })
  ReorderApp.model = {
    REVERSE: s => ({ ...s, items: s.items.slice().reverse() }),
    SWAP: s => ({ ...s, items: move(s.items, 0, 1) }),
    LAST_FIRST: s => ({ ...s, items: move(s.items, s.items.length - 1, 0) }),
  }

  async function mountReorder() {
    const { id, el } = mount()
    run(ReorderApp, {}, { mountPoint: id })
    await waitFor(() => el.querySelectorAll('.row').length === 4)
    return el
  }

  await runTest(CAT, 'B-010: reversing a Collection reorders the DOM and keeps item identity', async () => {
    const el = await mountReorder()
    // give item "b" local state: a click count and a ticked checkbox
    const rowB = el.querySelectorAll('.row')[1]
    rowB.querySelector('.bump').click()
    await waitFor(() => rowB.querySelector('.clicks').textContent === '1')
    rowB.querySelector('.done').click()
    await wait(40)
    el.querySelector('.reverse').click()
    await wait(60)
    assert(texts(el, '.name') === 'd,c,b,a', `order after reverse: ${texts(el, '.name')}`)
    const rows = el.querySelectorAll('.row')
    assert(rows[2] === rowB, 'item b should keep its DOM element')
    assert(rows[2].querySelector('.clicks').textContent === '1', 'item b keeps its click count')
    assert(rows[2].querySelector('.done').checked === true, 'item b keeps its checkbox')
    assert(rows[1].querySelector('.done').checked === false, 'item c stays unchecked')
  })

  await runTest(CAT, 'B-010: swap and move-to-index reorder the DOM', async () => {
    const el = await mountReorder()
    el.querySelector('.swap').click()
    await wait(60)
    assert(texts(el, '.name') === 'b,a,c,d', `order after swap: ${texts(el, '.name')}`)
    el.querySelector('.last-first').click()
    await wait(60)
    assert(texts(el, '.name') === 'd,b,a,c', `order after move: ${texts(el, '.name')}`)
    // an item's own state change afterwards still renders in the new order
    el.querySelectorAll('.row')[0].querySelector('.bump').click()
    await wait(60)
    assert(texts(el, '.name') === 'd,b,a,c', `order after bump: ${texts(el, '.name')}`)
    assert(texts(el, '.clicks') === '1,0,0,0', `clicks after bump: ${texts(el, '.clicks')}`)
  })

  await runTest(CAT, 'B-010: nested Collections follow cross-list moves and in-list reorders', async () => {
    const { id, el } = mount()
    function Card({ state }) {
      return <div className="card"><span className="title">{state.title}</span><span className="hits">{state.hits}</span><button className="hit">hit</button></div>
    }
    Card.intent = ({ DOM }) => ({ HIT: DOM.click('.hit') })
    Card.model = { HIT: s => ({ ...s, hits: s.hits + 1 }) }
    function List({ state }) {
      return <section className="list"><Collection of={Card} from="cards" /></section>
    }
    function Board({ state }) {
      return <div>
        <button className="cross">Cross</button>
        <button className="rev">Rev</button>
        <Collection of={List} from="lists" />
      </div>
    }
    Board.initialState = {
      lists: [
        { id: 'l1', cards: [{ id: 'x', title: 'x', hits: 0 }, { id: 'y', title: 'y', hits: 0 }] },
        { id: 'l2', cards: [{ id: 'z', title: 'z', hits: 0 }] },
      ],
    }
    Board.intent = ({ DOM }) => ({ CROSS: DOM.click('.cross'), REV: DOM.click('.rev') })
    Board.model = {
      // move the last card of list 1 to the top of list 2
      CROSS: s => {
        const [l1, l2] = s.lists
        const card = l1.cards[l1.cards.length - 1]
        return { ...s, lists: [{ ...l1, cards: l1.cards.slice(0, -1) }, { ...l2, cards: [card, ...l2.cards] }] }
      },
      // reverse the cards of list 2 (pure reorder inside a nested Collection)
      REV: s => ({ ...s, lists: [s.lists[0], { ...s.lists[1], cards: s.lists[1].cards.slice().reverse() }] }),
    }
    run(Board, {}, { mountPoint: id })
    await waitFor(() => el.querySelectorAll('.card').length === 3)
    const listText = () => [...el.querySelectorAll('.list')].map(l => texts(l, '.title')).join('|')
    const z = [...el.querySelectorAll('.card')].find(c => c.textContent.startsWith('z'))
    z.querySelector('.hit').click()
    await wait(60)
    el.querySelector('.cross').click()
    await wait(60)
    assert(listText() === 'x|y,z', `after cross move: ${listText()}`)
    el.querySelector('.rev').click()
    await wait(60)
    assert(listText() === 'x|z,y', `after nested reverse: ${listText()}`)
    const zNow = [...el.querySelectorAll('.card')].find(c => c.textContent.startsWith('z'))
    assert(zNow === z, 'card z keeps its DOM element')
    assert(zNow.querySelector('.hits').textContent === '1', 'card z keeps its hit count')
  })

  // ─── B-011: single text child <-> several children on the same element ────
  async function mountToggle(view) {
    const { id, el } = mount()
    function App({ state }) {
      return <div><button className="flip">flip</button>{view(state)}</div>
    }
    App.initialState = { on: false, status: 'Open' }
    App.intent = ({ DOM }) => ({ FLIP: DOM.click('.flip') })
    App.model = { FLIP: s => ({ ...s, on: !s.on }) }
    run(App, {}, { mountPoint: id })
    await waitFor(() => el.querySelector('.flip'))
    const flip = async () => { el.querySelector('.flip').click(); await wait(50) }
    return { el, flip }
  }

  await runTest(CAT, 'B-011: one text child -> several children replaces the text', async () => {
    const { el, flip } = await mountToggle(s => s.on ? <p className="p">Status: {s.status}</p> : <p className="p">Select a task.</p>)
    assert(el.querySelector('.p').textContent === 'Select a task.', 'initial text')
    await flip()
    assert(el.querySelector('.p').textContent === 'Status: Open', `after switch: "${el.querySelector('.p').textContent}"`)
    await flip()
    assert(el.querySelector('.p').textContent === 'Select a task.', `after switching back: "${el.querySelector('.p').textContent}"`)
    await flip()
    assert(el.querySelector('.p').textContent === 'Status: Open', `after third switch: "${el.querySelector('.p').textContent}"`)
  })

  await runTest(CAT, 'B-011: one text child <-> mixed text and element children', async () => {
    const { el, flip } = await mountToggle(s => s.on
      ? <p className="p">Status: <b>{s.status}</b> now</p>
      : <p className="p">Nothing</p>)
    await flip()
    const p = el.querySelector('.p')
    assert(p.textContent === 'Status: Open now', `mixed: "${p.textContent}"`)
    assert(p.querySelector('b') && p.querySelector('b').textContent === 'Open', 'has <b>')
    await flip()
    assert(el.querySelector('.p').textContent === 'Nothing', `back to text: "${el.querySelector('.p').textContent}"`)
    assert(!el.querySelector('.p b'), 'the <b> is gone')
  })

  await runTest(CAT, 'B-011: one element child <-> one text child', async () => {
    const { el, flip } = await mountToggle(s => s.on ? <p className="p"><i>it</i></p> : <p className="p">plain</p>)
    await flip()
    assert(el.querySelector('.p').innerHTML === '<i>it</i>', `element: ${el.querySelector('.p').innerHTML}`)
    await flip()
    assert(el.querySelector('.p').innerHTML === 'plain', `text: ${el.querySelector('.p').innerHTML}`)
  })

  await runTest(CAT, 'B-011: a component still receives a single text child', async () => {
    const { id, el } = mount()
    function Label({ children }) { return <span className="label">[{children}]</span> }
    function App() { return <div><Label>hello</Label></div> }
    run(App, {}, { mountPoint: id })
    await waitFor(() => el.querySelector('.label'))
    assert(el.querySelector('.label').textContent === '[hello]', `label: ${el.querySelector('.label').textContent}`)
  })

  // ─── B-012: removing className from a reused element clears it ─────────────
  const cls = (el, sel) => el.querySelector(sel).getAttribute('class') || ''

  await runTest(CAT, 'B-012: <p className="placeholder"> -> <p> removes the class', async () => {
    const { el, flip } = await mountToggle(s => <div className="box">{s.on ? <p id="b012a">details</p> : <p id="b012a" className="placeholder">none</p>}</div>)
    assert(cls(el, '#b012a') === 'placeholder', `initial: "${cls(el, '#b012a')}"`)
    await flip()
    assert(cls(el, '#b012a') === '', `after removal: "${cls(el, '#b012a')}"`)
    await flip()
    assert(cls(el, '#b012a') === 'placeholder', `re-added: "${cls(el, '#b012a')}"`)
  })

  await runTest(CAT, 'B-012: className={cond ? "x" : undefined|null} clears it; switching still works', async () => {
    const { el, flip } = await mountToggle(s => <div>
      <p id="b012b" className={s.on ? undefined : 'x'}>b</p>
      <p id="b012c" className={s.on ? null : 'x'}>c</p>
      <p id="b012d" className={s.on ? 'two' : 'one'}>d</p>
    </div>)
    await flip()
    assert(cls(el, '#b012b') === '', `undefined: "${cls(el, '#b012b')}"`)
    assert(cls(el, '#b012c') === '', `null: "${cls(el, '#b012c')}"`)
    assert(cls(el, '#b012d') === 'two', `switch: "${cls(el, '#b012d')}"`)
    await flip()
    assert(cls(el, '#b012b') === 'x' && cls(el, '#b012c') === 'x' && cls(el, '#b012d') === 'one', 'restored')
  })

  await runTest(CAT, 'B-012: removing className keeps class={{...}} and classes from other sources', async () => {
    const { el, flip } = await mountToggle(s => <div>{s.on
      ? <p id="b012e" class={{ active: true }}>e</p>
      : <p id="b012e" className="placeholder" class={{ active: true }}>e</p>}</div>)
    await flip()
    const c = cls(el, '#b012e').split(/\s+/).filter(Boolean).sort().join(' ')
    assert(c === 'active', `after removal: "${c}"`)
  })

  await runTest(CAT, 'B-012: class={{...}} entries are added and removed', async () => {
    const { el, flip } = await mountToggle(s => <p id="b012f" class={{ on: s.on, off: !s.on }}>f</p>)
    assert(cls(el, '#b012f') === 'off', `initial: "${cls(el, '#b012f')}"`)
    await flip()
    assert(cls(el, '#b012f') === 'on', `flipped: "${cls(el, '#b012f')}"`)
  })

  // ─── B-013: same-tick actions inside a Collection item ─────────────────────
  await runTest(CAT, 'B-013: EDIT (input) then SAVE (click) in one tick inside a Collection item', async () => {
    const { id, el } = mount()
    const saved = []
    function Note({ state }) {
      return <li className="note">
        <input className="draft" value={state.draft} />
        <button className="save">Save</button>
        <span className="saved">{state.saved}</span>
      </li>
    }
    Note.intent = ({ DOM }) => ({ EDIT: DOM.input('.draft').value(), SAVE: DOM.click('.save') })
    Note.model = {
      EDIT: (s, draft) => ({ ...s, draft }),
      SAVE: { STATE: s => ({ ...s, saved: s.draft }), EVENTS: s => ({ type: 'SAVED', data: s.draft }) },
    }
    function Notes() { return <ul><Collection of={Note} from="notes" /></ul> }
    Notes.initialState = { notes: [{ id: 1, draft: '', saved: '' }, { id: 2, draft: '', saved: '' }] }
    Notes.intent = ({ EVENTS }) => ({ GOT: EVENTS.select('SAVED') })
    Notes.model = { GOT: (s, d) => { saved.push(d); return s } }
    run(Notes, {}, { mountPoint: id })
    await waitFor(() => el.querySelectorAll('.note').length === 2)
    const note = el.querySelectorAll('.note')[1]
    const inp = note.querySelector('.draft')
    inp.value = 'hello'
    inp.dispatchEvent(new Event('input', { bubbles: true }))
    note.querySelector('.save').click()
    await wait(80)
    assert(note.querySelector('.saved').textContent === 'hello', `saved: "${note.querySelector('.saved').textContent}"`)
    assert(inp.value === 'hello', `draft: "${inp.value}"`)
    assert(JSON.stringify(saved) === '["hello"]', `EVENTS: ${JSON.stringify(saved)}`)
  })

  // ─── G-018: a ready child component adds no data-sygnal-ready attribute ────
  await runTest(CAT, 'G-018: extracting markup into a child component leaves the DOM unchanged', async () => {
    const { id, el } = mount()
    function Stars({ state }) { return <span className="stars">{state.n}</span> }
    function Loader({ state }) { return <em className="loader">{state.done ? 'done' : 'wait'}</em> }
    Loader.intent = ({ DOM }) => ({ LOAD: DOM.click('.loader') })
    Loader.model = { LOAD: { STATE: s => ({ ...s, done: true }), READY: () => true } }
    function App() { return <div className="g018"><Stars /><Loader /></div> }
    App.initialState = { n: 3, done: false }
    run(App, {}, { mountPoint: id })
    await waitFor(() => el.querySelector('.stars') && el.querySelector('.loader'))
    await wait(30)
    assert(el.querySelector('.stars').outerHTML === '<span class="stars">3</span>', el.querySelector('.stars').outerHTML)
    assert(el.querySelector('.loader').getAttribute('data-sygnal-ready') === 'false', 'not-ready child is marked')
    el.querySelector('.loader').click()
    await waitFor(() => el.querySelector('.loader').textContent === 'done')
    await wait(30)
    assert(!el.querySelector('.loader').hasAttribute('data-sygnal-ready'), 'mark removed once ready')
  })
}
