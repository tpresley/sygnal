// PLAN-5 4-H (D229, G-554; BROWSER=chromium|firefox|webkit): a Collection has no wrapper element;
// its items are flattened into the parent element's children (a keyed fragment, 3-Q's flat()).
// The stability evidence for dropping the wrapper, in a real engine, with real typing and focus:
// items between static siblings (reverse, insert at the start / middle / end, remove), two sibling
// Collections in one parent with the same ids and the same user keys, empty <-> non-empty,
// nested Collections (an item that is a fragment with its own Collection), Transition on items
// (insert during a leave), view-transition names, and focus parity with a mapped keyed list and
// 5.x's wrapper div (a reorder that moves the focused element drops the focus in all three).
// Each structural case runs on a fresh client render and over renderToString's markup (hydrated:
// every server element adopted, the server's markup equal to the client's).
import { run, renderToString, Collection, Transition, makeViewTransitionDOMDriver, defineWidget } from 'sygnal'
import { mountOnScreen, clearStage, assert, runTest as run_, wait, waitFor } from '../harness.js'

const CAT = 'Collection without a wrapper (PLAN-5 4-H)'
const hasPw = () => typeof window.__pw === 'function'
const runTest = (name, fn, ms = 8000) => run_(CAT, name, async () => {
  if (!hasPw()) return
  window.scrollTo(0, 0)
  try { await fn() } finally { clearStage() }
}, ms)

// every app: `n` counts the operations; OP applies a function of the state sent with a document event
const withOps = (App) => {
  App.intent = ({ DOM }) => ({ OP: DOM.select('document').events('p4h-op').map((e) => e.detail) })
  App.model = { OP: (s, f) => ({ ...f(s), n: s.n + 1 }) }
  return App
}
/** apply f to the state and wait for the patch */
async function op(el, f) {
  const n = +el.querySelector('.p4h-n').textContent
  document.dispatchEvent(new CustomEvent('p4h-op', { detail: f }))
  await waitFor(() => +el.querySelector('.p4h-n').textContent === n + 1, 1000, 5)
  await wait(20)
}
const strip = (h) => h.replace(/ data-sygnal-ssr=""/g, '')

/** mount App fresh or over its server markup; checks the hydration (adopted, same markup) */
async function start(App, mode, root = 'main') {
  const { id, el } = mountOnScreen()
  let server
  if (mode == 'hydrated') { el.innerHTML = renderToString(App, { state: App.initialState }); server = strip(el.innerHTML) }
  const before = [...el.querySelectorAll('*')]
  const app = run(App, {}, { mountPoint: id })
  await waitFor(() => el.querySelector('.p4h-n') && !el.querySelector('[data-sygnal-ssr]'))
  await wait(30)
  if (mode == 'hydrated') {
    const gone = before.filter((e) => !e.isConnected).map((e) => e.localName + '.' + e.className)
    assert(!gone.length, 'server elements replaced: ' + gone.join(', '))
    assert(el.innerHTML === server, `client markup differs from the server's:\n${el.innerHTML}\n${server}`)
  }
  assert(!el.querySelector(root + ' div'), 'a wrapper div: ' + el.innerHTML)
  return { id, el, app }
}

// ---- A: items between static siblings ---------------------------------------------------------
function Row({ state }) { return <li className="p4h-row" data-id={String(state.id)}>{String(state.id)}<input className={'p4h-in-' + state.id} /></li> }
const Rows = withOps(function Rows({ state }) {
  return (
    <main>
      <ul className="p4h-list">
        <li className="p4h-head">head</li>
        <Collection of={Row} from="items" />
        <li className="p4h-tail">tail</li>
      </ul>
      <p className="p4h-n">{state.n}</p>
    </main>
  )
})
Rows.initialState = { n: 0, items: [1, 2, 3, 4].map((id) => ({ id })) }

// ---- B: two sibling Collections, the same ids and the same user keys ---------------------------
function Keyed({ state }) { return <li key={state.id} className="p4h-k">{state.l}</li> }
const Pair = withOps(function Pair({ state }) {
  return (
    <main>
      <ul className="p4h-pair">
        <Collection of={Keyed} from="a" />
        <li className="p4h-sep">|</li>
        <Collection of={Keyed} from="b" />
      </ul>
      <p className="p4h-n">{state.n}</p>
    </main>
  )
})
Pair.initialState = { n: 0, a: [1, 2, 3].map((id) => ({ id, l: 'a' + id })), b: [1, 2, 3].map((id) => ({ id, l: 'b' + id })) }

// ---- C: empty <-> non-empty, alone and between siblings ----------------------------------------
function Dot({ state }) { return <li className="p4h-dot">{String(state.id)}</li> }
const Empty = withOps(function Empty({ state }) {
  return (
    <main>
      <ul className="p4h-solo"><Collection of={Dot} from="items" /></ul>
      <ol className="p4h-mid"><li className="p4h-h">h</li><Collection of={Dot} from="items" /><li className="p4h-t">t</li></ol>
      <p className="p4h-n">{state.n}</p>
    </main>
  )
})
Empty.initialState = { n: 0, items: [] }

// ---- D: nested Collections, flattened through an item that is a fragment -----------------------
function Leaf({ state }) { return <li className="p4h-leaf">{'l' + state.id}</li> }
function Group({ state }) { return <><li className="p4h-group">{state.title}</li><Collection of={Leaf} from="leaves" /></> }
const Tree = withOps(function Tree({ state }) {
  return (
    <main>
      <ul className="p4h-tree"><li className="p4h-top">top</li><Collection of={Group} from="groups" /><li className="p4h-end">end</li></ul>
      <p className="p4h-n">{state.n}</p>
    </main>
  )
})
Tree.initialState = { n: 0, groups: [{ id: 'A', title: 'A', leaves: [{ id: 1 }, { id: 2 }] }, { id: 'B', title: 'B', leaves: [{ id: 3 }] }] }

const texts = (el, sel) => [...el.querySelector(sel).children].map((c) => c.firstChild?.textContent ?? c.textContent).join(',')
const byText = (el, sel) => new Map([...el.querySelector(sel).children].map((c) => [c.firstChild?.textContent ?? c.textContent, c]))
/** every element still there is the same element as in `was` */
function same(el, sel, was, label) {
  for (const [k, e] of byText(el, sel)) if (was.has(k)) assert(was.get(k) === e, `${label}: ${k} is a new element`)
}

export async function collectionTestsP5_4H() {
  for (const mode of ['fresh', 'hydrated']) {
    await runTest(`${mode}: items between static siblings: reverse, insert at the start / middle / end, remove; elements, typed text and focus kept`, async () => {
      const { id, el, app } = await start(Rows, mode)
      try {
        const L = '.p4h-list'
        assert(texts(el, L) === 'head,1,2,3,4,tail', texts(el, L))
        const was = byText(el, L)
        await window.__pw('type', `${id} .p4h-in-2`, 'typed')
        await window.__pw('focus', `${id} .p4h-in-2`)
        const in2 = el.querySelector('.p4h-in-2')
        const steps = [
          // (moves: snabbdom moves the focused element itself, which drops the focus in every engine,
          // as in a mapped keyed list and in 5.x's wrapper div: the parity test below)
          ['reverse', (s) => ({ ...s, items: [...s.items].reverse() }), 'head,4,3,2,1,tail', 'moves'],
          ['insert at the start', (s) => ({ ...s, items: [{ id: 10 }, ...s.items] }), 'head,10,4,3,2,1,tail'],
          ['insert in the middle', (s) => ({ ...s, items: [...s.items.slice(0, 3), { id: 11 }, ...s.items.slice(3)] }), 'head,10,4,3,11,2,1,tail'],
          ['insert at the end', (s) => ({ ...s, items: [...s.items, { id: 12 }] }), 'head,10,4,3,11,2,1,12,tail'],
          ['remove at the start', (s) => ({ ...s, items: s.items.slice(1) }), 'head,4,3,11,2,1,12,tail'],
          ['remove in the middle', (s) => ({ ...s, items: s.items.filter((i) => i.id != 11) }), 'head,4,3,2,1,12,tail'],
          ['remove at the end', (s) => ({ ...s, items: s.items.slice(0, -1) }), 'head,4,3,2,1,tail'],
          ['move one to the front', (s) => ({ ...s, items: [s.items[2], ...s.items.filter((_, i) => i != 2)] }), 'head,2,4,3,1,tail', 'moves'],
          ['move another one to the front', (s) => ({ ...s, items: [s.items[3], ...s.items.slice(0, 3)] }), 'head,1,2,4,3,tail'],
          ['swap the last two', (s) => ({ ...s, items: [...s.items.slice(0, 2), s.items[3], s.items[2]] }), 'head,1,2,3,4,tail'],
        ]
        for (const [what, f, want, moves] of steps) {
          await op(el, f)
          assert(texts(el, L) === want, `${what}: ${texts(el, L)}`)
          same(el, L, was, what)
          assert(el.querySelector('.p4h-in-2') === in2 && in2.value === 'typed', `${what}: the typed input moved with its item`)
          if (moves) await window.__pw('focus', `${id} .p4h-in-2`)
          else assert(document.activeElement === in2, `${what}: focus on ${document.activeElement?.outerHTML?.slice(0, 50)}`)
          assert([...el.querySelector(L).children].every((c) => c.localName == 'li'), `${what}: ${el.querySelector(L).innerHTML}`)
        }
        // typing goes on in the same field
        await window.__pw('type', `${id} .p4h-in-2`, '!')
        assert(in2.value === 'typed!', in2.value)
      } finally { app.dispose() }
    })

    await runTest(`${mode}: two sibling Collections in one parent with the same ids and user keys stay apart`, async () => {
      const { el, app } = await start(Pair, mode)
      try {
        const P = '.p4h-pair'
        assert(texts(el, P) === 'a1,a2,a3,|,b1,b2,b3', texts(el, P))
        const was = byText(el, P)
        const steps = [
          ['reverse a', (s) => ({ ...s, a: [...s.a].reverse() }), 'a3,a2,a1,|,b1,b2,b3'],
          ['reverse b', (s) => ({ ...s, b: [...s.b].reverse() }), 'a3,a2,a1,|,b3,b2,b1'],
          // a3 moves to b (another Collection: a new element there, as with any keyed list)
          ['move a3 to b', (s) => ({ ...s, a: s.a.slice(1), b: [...s.b, { id: 4, l: 'a3' }] }), 'a2,a1,|,b3,b2,b1,a3'],
          ['empty a', (s) => ({ ...s, a: [] }), '|,b3,b2,b1,a3'],
          ['fill a with b\'s ids', (s) => ({ ...s, a: [{ id: 3, l: 'x3' }, { id: 1, l: 'x1' }] }), 'x3,x1,|,b3,b2,b1,a3'],
          ['empty b', (s) => ({ ...s, b: [] }), 'x3,x1,|'],
          ['both again', (s) => ({ ...s, a: [{ id: 1, l: 'y1' }], b: [{ id: 1, l: 'z1' }] }), 'y1,|,z1'],
        ]
        for (const [what, f, want] of steps) {
          await op(el, f)
          assert(texts(el, P) === want, `${what}: ${texts(el, P)}`)
          if (what.startsWith('reverse')) same(el, P, was, what)
        }
      } finally { app.dispose() }
    })

    await runTest(`${mode}: empty <-> non-empty, alone in its parent and between siblings`, async () => {
      const { el, app } = await start(Empty, mode)
      try {
        const check = (items, what) => {
          assert(texts(el, '.p4h-solo') === items, `${what} (alone): ${texts(el, '.p4h-solo')}`)
          assert(texts(el, '.p4h-mid') === ['h', items, 't'].filter(Boolean).join(), `${what} (between): ${texts(el, '.p4h-mid')}`)
        }
        check('', 'empty')
        assert(el.querySelector('.p4h-solo').childNodes.length === 0, 'an empty Collection renders nothing: ' + el.querySelector('.p4h-solo').innerHTML)
        await op(el, (s) => ({ ...s, items: [{ id: 1 }, { id: 2 }] }))
        check('1,2', 'filled')
        const one = el.querySelector('.p4h-mid .p4h-dot')
        await op(el, (s) => ({ ...s, items: [] }))
        check('', 'emptied')
        assert(el.querySelector('.p4h-solo').childNodes.length === 0, 'emptied: ' + el.querySelector('.p4h-solo').innerHTML)
        await op(el, (s) => ({ ...s, items: [{ id: 3 }] }))
        check('3', 'filled again')
        await op(el, (s) => ({ ...s, items: [{ id: 1 }, ...s.items, { id: 4 }] }))
        check('1,3,4', 'around the one item')
        assert(one.isConnected === false, 'a removed item is gone')
      } finally { app.dispose() }
    })

    await runTest(`${mode}: nested Collections flatten into one list (an item that is a fragment with its own Collection)`, async () => {
      const { el, app } = await start(Tree, mode)
      try {
        const T = '.p4h-tree'
        assert(texts(el, T) === 'top,A,l1,l2,B,l3,end', texts(el, T))
        const was = byText(el, T)
        const steps = [
          ['reverse the groups', (s) => ({ ...s, groups: [...s.groups].reverse() }), 'top,B,l3,A,l1,l2,end'],
          ['reverse A\'s leaves', (s) => ({ ...s, groups: s.groups.map((g) => g.id == 'A' ? { ...g, leaves: [...g.leaves].reverse() } : g) }), 'top,B,l3,A,l2,l1,end'],
          ['add a leaf at A\'s start', (s) => ({ ...s, groups: s.groups.map((g) => g.id == 'A' ? { ...g, leaves: [{ id: 9 }, ...g.leaves] } : g) }), 'top,B,l3,A,l9,l2,l1,end'],
          ['empty B', (s) => ({ ...s, groups: s.groups.map((g) => g.id == 'B' ? { ...g, leaves: [] } : g) }), 'top,B,A,l9,l2,l1,end'],
          ['add a group in the middle', (s) => ({ ...s, groups: [s.groups[0], { id: 'C', title: 'C', leaves: [{ id: 5 }] }, s.groups[1]] }), 'top,B,C,l5,A,l9,l2,l1,end'],
          ['remove group B', (s) => ({ ...s, groups: s.groups.filter((g) => g.id != 'B') }), 'top,C,l5,A,l9,l2,l1,end'],
          ['reverse the groups again', (s) => ({ ...s, groups: [...s.groups].reverse() }), 'top,A,l9,l2,l1,C,l5,end'],
        ]
        for (const [what, f, want] of steps) {
          await op(el, f)
          assert(texts(el, T) === want, `${what}: ${texts(el, T)}`)
          same(el, T, was, what)
        }
      } finally { app.dispose() }
    })
  }

  await runTest('a keyed reorder keeps the focus exactly as a mapped keyed list and 5.x\'s wrapper div do', async () => {
    function Pin({ state }) { return <li>{String(state.id)}<input className={'p4h-pin-' + state.id} /></li> }
    const ORDERS = {
      'reverse': (a) => [...a].reverse(),
      'rotate left': (a) => [...a.slice(1), a[0]],
      'rotate right': (a) => [a[3], ...a.slice(0, 3)],
      'swap the last two': (a) => [a[0], a[1], a[3], a[2]],
      'move the focused one last': (a) => [a[0], a[2], a[3], a[1]],
    }
    const kept = async (layout, order) => {
      const Probe = withOps(function Probe({ state }) {
        const list = layout == 'mapped'
          ? state.items.map((i) => <li key={i.id}>{String(i.id)}<input className={'p4h-pin-' + i.id} /></li>)
          : <Collection of={Pin} from="items" />
        return <main><ul>{layout == 'wrapper div (5.x)' ? <div>{list}</div> : list}</ul><p className="p4h-n">{state.n}</p></main>
      })
      Probe.initialState = { n: 0, items: [1, 2, 3, 4].map((id) => ({ id })) }
      const { id, el } = mountOnScreen()
      const app = run(Probe, {}, { mountPoint: id })
      try {
        await waitFor(() => el.querySelector('.p4h-n'))
        await wait(20)
        await window.__pw('focus', `${id} .p4h-pin-2`)
        const inp = el.querySelector('.p4h-pin-2')
        await op(el, (s) => ({ ...s, items: ORDERS[order](s.items) }))
        assert(el.querySelector('.p4h-pin-2') === inp, `${layout}, ${order}: a new element`)
        return document.activeElement === inp
      } finally { app.dispose(); clearStage() }
    }
    const out = []
    for (const order in ORDERS) {
      const r = {}
      for (const layout of ['collection', 'wrapper div (5.x)', 'mapped']) r[layout] = await kept(layout, order)
      out.push(`${order}: ${JSON.stringify(r)}`)
      assert(r.collection === r['wrapper div (5.x)'] && r.collection === r.mapped, out.join('; '))
      // only a reorder that moves the focused element itself drops the focus (snabbdom's insertBefore)
      if (order.startsWith('rotate') || order.startsWith('swap')) assert(r.collection, out.join('; '))
    }
  }, 20000)

  await runTest('Transition on items: a leaving item keeps its place, an item inserted meanwhile lands in order', async () => {
    function Faded({ state }) { return <Transition name="p4h" duration={150}><li className="p4h-tr">{String(state.id)}</li></Transition> }
    const Fades = withOps(function Fades({ state }) {
      return <main><ul className="p4h-fades"><li className="p4h-head">head</li><Collection of={Faded} from="items" /><li className="p4h-tail">tail</li></ul><p className="p4h-n">{state.n}</p></main>
    })
    Fades.initialState = { n: 0, items: [{ id: 1 }, { id: 2 }, { id: 3 }] }
    const { el, app } = await start(Fades, 'fresh')
    try {
      const F = '.p4h-fades'
      await wait(200)
      const two = [...el.querySelectorAll('.p4h-tr')].find((e) => e.textContent == '2')
      await op(el, (s) => ({ ...s, items: s.items.filter((i) => i.id != 2) }))
      assert(two.isConnected && two.classList.contains('p4h-leave-active'), 'leaving: ' + two.className)
      assert(texts(el, F) === 'head,1,2,3,tail', 'during the leave: ' + texts(el, F))
      await op(el, (s) => ({ ...s, items: [s.items[0], { id: 9 }, ...s.items.slice(1)] }))
      const nine = [...el.querySelectorAll('.p4h-tr')].find((e) => e.textContent == '9')
      assert(nine && nine.classList.contains('p4h-enter-active'), 'entering: ' + nine?.className)
      await waitFor(() => !two.isConnected, 1000, 10)
      await wait(30)
      assert(texts(el, F) === 'head,1,9,3,tail', 'after the leave: ' + texts(el, F))
      await op(el, (s) => ({ ...s, items: [...s.items].reverse() }))
      assert(texts(el, F) === 'head,3,9,1,tail', 'reversed: ' + texts(el, F))
    } finally { app.dispose() }
  })

  // 4-I G-559: <Transition> around a Collection animates each item (no wrapper element to animate)
  await runTest('Transition around a Collection: each item enters and leaves on its own, in place', async () => {
    function Plain({ state }) { return <li className="p4i-tr">{String(state.id)}</li> }
    const Wrapped = withOps(function Wrapped({ state }) {
      return <main><ul className="p4i-fades"><li className="p4h-head">head</li><Transition name="p4i" duration={150}><Collection of={Plain} from="items" /></Transition><li className="p4h-tail">tail</li></ul><p className="p4h-n">{state.n}</p></main>
    })
    Wrapped.initialState = { n: 0, items: [{ id: 1 }, { id: 2 }, { id: 3 }] }
    const { el, app } = await start(Wrapped, 'fresh')
    try {
      const F = '.p4i-fades', item = (t) => [...el.querySelectorAll('.p4i-tr')].find((e) => e.textContent == t)
      assert(item('1').classList.contains('p4i-enter-active'), 'first render enters: ' + item('1').className)
      await wait(200)
      assert(item('1').className === 'p4i-tr', 'enter done: ' + item('1').className)
      const two = item('2'), one = item('1')
      await op(el, (s) => ({ ...s, items: s.items.filter((i) => i.id != 2) }))
      assert(two.isConnected && two.classList.contains('p4i-leave-active'), 'leaving: ' + two.className)
      assert(texts(el, F) === 'head,1,2,3,tail', 'during the leave: ' + texts(el, F))
      await op(el, (s) => ({ ...s, items: [s.items[0], { id: 9 }, ...s.items.slice(1)] }))
      assert(item('9').classList.contains('p4i-enter-active'), 'entering: ' + item('9').className)
      assert(one.className === 'p4i-tr' && item('1') === one, 'an unchanged item is untouched: ' + one.className)
      await waitFor(() => !two.isConnected, 1000, 10)
      await wait(30)
      assert(texts(el, F) === 'head,1,9,3,tail', 'after the leave: ' + texts(el, F))
      await op(el, (s) => ({ ...s, items: [...s.items].reverse() }))
      assert(texts(el, F) === 'head,3,9,1,tail', 'reversed: ' + texts(el, F))
      assert(!el.querySelector(F + ' div'), 'no wrapper: ' + el.innerHTML)
    } finally { app.dispose() }
  })

  // 4-J G-564: the list element is recreated (<ul> <-> <ol>) around unchanged items: the old items'
  // widgets unmount with their own elements, the new ones mount, and a real click reaches an item
  await runTest('<ul> <-> <ol> around a Collection: widgets in items unmount and mount in balance, clicks reach the items', async () => {
    const log = []
    const Box = defineWidget({
      mount(el, p) { log.push('+' + p.id); el.textContent = 'w' + p.id; return { id: p.id, el } },
      unmount(i, el) { log.push('-' + i.id + (el === i.el ? '' : '?')) },
      update() {},
    })
    function Item({ state }) { return <li className="p4j-it" data-id={String(state.id)}><button className="p4j-b">{String(state.hits || 0)}</button><Box id={state.id} /></li> }
    Item.intent = ({ DOM }) => ({ HIT: DOM.select('.p4j-b').events('click') })
    Item.model = { HIT: (s) => ({ ...s, hits: (s.hits || 0) + 1 }) }
    const Swap = withOps(function Swap({ state }) {
      const c = <Collection of={Item} from="items" />
      return <main>{state.alt ? <ol className="p4j-l">{c}</ol> : <ul className="p4j-l">{c}</ul>}<p className="p4h-n">{state.n}</p></main>
    })
    Swap.initialState = { n: 0, alt: false, items: [{ id: 1 }, { id: 2 }] }
    const { el, app } = await start(Swap, 'fresh', 'main > .p4j-l >')
    try {
      for (const alt of [true, false, true]) {
        log.length = 0
        await op(el, (s) => ({ ...s, alt }))
        assert(el.querySelector('.p4j-l').localName === (alt ? 'ol' : 'ul'), el.innerHTML)
        assert(log.join() === '-1,-2,+1,+2', 'widgets: ' + log.join())
        assert(el.querySelectorAll('.p4j-it').length === 2, el.innerHTML)
      }
      await window.__pw('click', '#' + el.id + ' .p4j-it[data-id="2"] .p4j-b')
      await waitFor(() => el.querySelector('.p4j-it[data-id="2"] .p4j-b').textContent === '1', 1000, 10)
    } finally { log.length = 0; app.dispose() }
    assert(log.sort().join() === '-1,-2', 'dispose unmounts the mounted widgets: ' + log.join())
  })

  await runTest('view-transition names on items between siblings; a reorder runs in one View Transition', async () => {
    function Card({ state }) { return <li className="p4h-card">{String(state.id)}</li> }
    const Cards = withOps(function Cards({ state }) {
      return <main><ul className="p4h-cards"><li className="p4h-head">head</li><Collection of={Card} from="items" viewTransitionName="p4hv" /><li className="p4h-tail">tail</li></ul><p className="p4h-n">{state.n}</p></main>
    })
    Cards.initialState = { n: 0, items: [{ id: 1 }, { id: 2 }, { id: 3 }] }
    Cards.viewTransitions = ['OP']
    const real = document.startViewTransition
    let calls = 0
    document.startViewTransition = function (cb) { calls++; return real.call(document, cb) }
    const { id, el } = mountOnScreen()
    const app = run(Cards, { DOM: makeViewTransitionDOMDriver(id) }, { mountPoint: id })
    try {
      await waitFor(() => el.querySelector('.p4h-n'))
      await wait(30)
      const names = () => [...el.querySelectorAll('.p4h-card')].map((c) => c.textContent + ':' + getComputedStyle(c).viewTransitionName).join()
      assert(names() === '1:p4hv-1,2:p4hv-2,3:p4hv-3', names())
      assert(getComputedStyle(el.querySelector('.p4h-head')).viewTransitionName === 'none', 'the siblings are not named')
      const was = byText(el, '.p4h-cards')
      await op(el, (s) => ({ ...s, items: [...s.items].reverse() }))
      await wait(50)
      assert(calls === 1, 'one View Transition: ' + calls)
      assert(texts(el, '.p4h-cards') === 'head,3,2,1,tail', texts(el, '.p4h-cards'))
      assert(names() === '3:p4hv-3,2:p4hv-2,1:p4hv-1', names())
      same(el, '.p4h-cards', was, 'reverse')
    } finally { document.startViewTransition = real; app.dispose() }
  })
}
