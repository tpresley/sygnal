// PLAN-5 3-D (B-1): the `sortable` behavior over a host's Collection with real input
// (BROWSER=chromium|firefox|webkit): Playwright mouse and keyboard (window.__pwInput / __pw), CDP
// touch (Chromium only). Skipped when the page is opened by hand.
import { run, Collection, sortable } from 'sygnal'
import { mountOnScreen, clearStage, assert, runTest, wait, waitFor } from '../harness.js'

const CAT = 'Sortable (PLAN-5 3-D)'
const ua = navigator.userAgent
const ENGINE = /Firefox\//.test(ua) ? 'firefox' : /Chrome\//.test(ua) ? 'chromium' : 'webkit'
// WebKit moves focus to buttons with Tab only when Option is held (macOS default)
const TAB = ENGINE === 'webkit' ? 'Alt+Tab' : 'Tab'

function Task({ state, context }) {
  const { dragging, over, after, helpId } = context.sort
  const id = String(state.id)
  const cls = ['task', dragging === id && 'dragging', over === id && dragging !== id && (after ? 'drop-after' : 'drop-before')]
  return (
    <li className={cls.filter(Boolean).join(' ')} data-id={state.id} style={{ height: '32px', listStyle: 'none', display: 'flex', gap: '8px', alignItems: 'center' }}>
      <button type="button" className="grip" aria-label={`Reorder ${state.title}`} aria-describedby={helpId || undefined}
        aria-pressed={String(dragging === id)} style={{ touchAction: 'none' }}>⠿</button>
      <span className="title">{state.title} with some selectable text</span>
    </li>
  )
}
function TaskList({ state }) {
  return (
    <section>
      <p id={state.sort.helpId || undefined} hidden>Press Space or Enter to pick up a task, the arrow keys to move it, Space or Enter to drop it, and Escape to cancel.</p>
      <ul className="tasks" style={{ margin: 0, padding: 0 }}><Collection of={Task} from="tasks" /></ul>
      <p className="announce" role="status" aria-live="assertive">{state.sort.message}</p>
      <p className="dropped">{state.dropped.join(';')}</p>
      <button type="button" className="after">After</button>
    </section>
  )
}
TaskList.initialState = {
  tasks: [{ id: 1, title: 'Write spec' }, { id: 2, title: 'Build prototype' }, { id: 3, title: 'Test it' }, { id: 4, title: 'Ship' }],
  dropped: [],
}
TaskList.uses = { sort: sortable({ from: 'tasks', item: '.task', handle: '.grip' }) }
TaskList.context = { sort: (state) => state.sort }
// the host saves the order on a completed move
TaskList.model = { 'sort.DROPPED': (s, d) => ({ ...s, dropped: [...s.dropped, `${d.id}:${d.fromList}${d.fromIndex}->${d.list}${d.index}`] }) }

function Card({ state, context }) {
  const { dragging } = context.sort
  return (
    <li className={dragging === String(state.id) ? 'card dragging' : 'card'} data-id={state.id} style={{ height: '28px', listStyle: 'none' }}>
      <button type="button" className="grip" aria-label={`Move ${state.title}`} style={{ touchAction: 'none' }}>⠿</button> {state.title}
    </li>
  )
}
function Board({ state }) {
  const col = { width: '160px', minHeight: '90px', margin: 0, padding: '4px', border: '1px solid #ccc' }
  return (
    <div style={{ display: 'flex', gap: '24px' }}>
      <ul className="todo" data-list="todo" style={col}><Collection of={Card} from="todo" /></ul>
      <ul className="done" data-list="done" style={col}><Collection of={Card} from="done" /></ul>
      <p role="status" aria-live="polite" className="announce">{state.sort.message}</p>
    </div>
  )
}
Board.initialState = { todo: [{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }], done: [], dropped: [] }
Board.uses = { sort: sortable({ from: ['todo', 'done'], item: '.card', handle: '.grip' }) }
Board.context = { sort: (state) => state.sort }
Board.model = { 'sort.DROPPED': (s, d) => ({ ...s, dropped: [...s.dropped, `${d.id}:${d.fromList}${d.fromIndex}->${d.list}${d.index}`] }) }

// no handle: the whole item (focusable) is dragged
function Row({ state, context }) {
  return (
    <li className={context.sort.dragging === state.id ? 'row dragging' : 'row'} data-id={state.id} tabIndex={0}
      aria-label={state.text} style={{ height: '28px', listStyle: 'none' }}>
      <span className="text">{state.text}, a row of selectable words</span>
    </li>
  )
}
function Rows({ state }) {
  return <div><ul style={{ margin: 0, padding: 0 }}><Collection of={Row} from="rows" /></ul><p role="status">{state.sort.message}</p></div>
}
Rows.initialState = { rows: [{ id: 'r1', text: 'First' }, { id: 'r2', text: 'Second' }, { id: 'r3', text: 'Third' }] }
Rows.uses = { sort: sortable({ from: 'rows', item: '.row' }) }
Rows.context = { sort: (state) => state.sort }

// 3-H G-444/G-445: nested sortables whose ids repeat between the levels
function Leaf({ state }) {
  return (
    <li className="node leaf" data-id={state.id} style={{ height: '24px', listStyle: 'none' }}>
      <button type="button" className="grip" aria-label={`Move leaf ${state.id}`} style={{ touchAction: 'none' }}>⠿</button> leaf {state.id}
    </li>
  )
}
function Group({ state }) {
  return (
    <li className="node group" data-id={state.id} style={{ listStyle: 'none', border: '1px solid #ccc', margin: '2px 0' }}>
      <button type="button" className="grip" aria-label={`Move group ${state.id}`} style={{ touchAction: 'none', height: '24px' }}>⠿</button> group {state.id}
      <ul style={{ margin: 0, paddingLeft: '24px' }}><Collection of={Leaf} from="children" /></ul>
    </li>
  )
}
Group.uses = { sort: sortable({ from: 'children', item: '.node', handle: '.grip' }) }
function Tree() { return <ul className="tree" style={{ margin: 0, padding: 0 }}><Collection of={Group} from="groups" /></ul> }
Tree.uses = { sort: sortable({ from: 'groups', item: '.node', handle: '.grip' }) }

const input = (steps) => window.__pwInput(steps)

export async function sortableTestsP5_3D() {
  // 3-H G-455: real input is the point of this suite: without the runner's helpers (the page
  // opened by hand) it fails instead of passing silently
  if (typeof window.__pwInput !== 'function' || typeof window.__pw !== 'function') {
    await runTest(CAT, 'real input (window.__pwInput / __pw from run-headless.mjs)', async () => {
      assert(false, 'window.__pwInput is missing: run the suite with npm --prefix browser-tests test')
    })
    return
  }
  const setup = async (C = TaskList, n = 4, sel = '.task') => {
    const { id, el } = mountOnScreen()
    const app = run(C, {}, { mountPoint: id })
    await waitFor(() => el.querySelectorAll(sel).length === n).catch(() => { throw new Error('not rendered: ' + el.innerHTML.slice(0, 300)) })
    await wait(20)
    const q = (s) => el.querySelector(s)
    const order = (s = '.task') => [...el.querySelectorAll(s)].map(e => e.dataset.id).join()
    const center = (s) => { const r = q(s).getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2] }
    const done = () => { app.dispose(); clearStage() }
    return { id, el, app, q, order, center, done }
  }

  await runTest(CAT, 'mouse: press a grip, drag past the threshold, drop over a later item', async () => {
    const { q, order, center, done } = await setup()
    try {
      const [x, y] = center('.task[data-id="1"] .grip'), [, y3] = center('.task[data-id="3"]')
      await input([['move', x, y], ['down'], ['move', x, y + 2], ['move', x, y3, 8], ['wait', 50]])
      await waitFor(() => q('.task[data-id="3"]').classList.contains('drop-after'))
      assert(q('.task[data-id="1"]').classList.contains('dragging'), 'dragged item styled from state.sort.dragging')
      assert(q('.task[data-id="1"] .grip').getAttribute('aria-pressed') === 'true', 'aria-pressed on the dragged grip')
      assert(order() === '1,2,3,4', 'indicator only while moving: ' + order())
      assert(q('.announce').textContent === 'Picked up Write spec, position 1 of 4.', 'lift announced: ' + q('.announce').textContent)
      await input([['up']])
      await waitFor(() => order() === '2,3,1,4')
      assert(q('.announce').textContent === 'Dropped Write spec at position 3 of 4.', 'drop announced')
      await waitFor(() => q('.dropped').textContent)
      assert(q('.dropped').textContent === '1:tasks0->tasks2', 'host DROPPED entry ran once: ' + q('.dropped').textContent)
      assert(!q('.dragging') && !q('.drop-after'), 'drag styling cleared')
    } finally { done() }
  }, 6000)

  await runTest(CAT, 'mouse: dragging upward lands before the hovered item', async () => {
    const { q, order, center, done } = await setup()
    try {
      const [x, y] = center('.task[data-id="4"] .grip'), [, y2] = center('.task[data-id="2"]')
      await input([['move', x, y], ['down'], ['move', x, y2, 8], ['wait', 50]])
      await waitFor(() => q('.task[data-id="2"]').classList.contains('drop-before'))
      await input([['up']])
      await waitFor(() => order() === '1,4,2,3')
    } finally { done() }
  }, 6000)

  await runTest(CAT, 'mouse: a press without a move past the threshold is not a drag', async () => {
    const { q, order, center, done } = await setup()
    try {
      const [x, y] = center('.task[data-id="2"] .grip')
      await input([['move', x, y], ['down'], ['move', x + 1, y + 2], ['up'], ['wait', 60]])
      assert(order() === '1,2,3,4', 'order unchanged')
      assert(!q('.dragging') && q('.announce').textContent === '', 'no drag state')
    } finally { done() }
  }, 6000)

  await runTest(CAT, 'mouse: Escape during a drag cancels it; releasing later changes nothing', async () => {
    const { q, order, center, done } = await setup()
    try {
      const [x, y] = center('.task[data-id="1"] .grip'), [, y4] = center('.task[data-id="4"]')
      await input([['move', x, y], ['down'], ['move', x, y4, 6], ['wait', 30]])
      await waitFor(() => q('.dragging'))
      await input([['key', 'Escape'], ['wait', 30], ['up'], ['wait', 60]])
      assert(order() === '1,2,3,4', 'order unchanged: ' + order())
      assert(!q('.dragging'), 'drag cleared')
      assert(/^Reorder cancelled/.test(q('.announce').textContent), 'cancel announced')
      assert(q('.dropped').textContent === '', 'no DROPPED')
    } finally { done() }
  }, 6000)

  await runTest(CAT, 'mouse: dropping outside the list changes nothing', async () => {
    const { order, center, done } = await setup()
    try {
      const [x, y] = center('.task[data-id="2"] .grip')
      await input([['move', x, y], ['down'], ['move', x + 600, y + 400, 6], ['up'], ['wait', 60]])
      assert(order() === '1,2,3,4', 'order unchanged: ' + order())
    } finally { done() }
  }, 6000)

  await runTest(CAT, 'mouse: dragging a whole item (no handle) by its text selects no text', async () => {
    const { q, order, center, done } = await setup(Rows, 3, '.row')
    try {
      window.getSelection()?.removeAllRanges()
      const [x, y] = center('.row[data-id="r1"] .text'), [, y3] = center('.row[data-id="r3"]')
      await input([['move', x, y], ['down'], ['move', x + 30, y3, 10], ['wait', 50]])
      await waitFor(() => q('.row[data-id="r1"]').classList.contains('dragging'))
      assert((window.getSelection()?.toString() || '') === '', 'text selected during the drag: ' + window.getSelection()?.toString())
      await input([['up']])
      await waitFor(() => order('.row') === 'r2,r3,r1')
    } finally { done() }
  }, 6000)

  if (ENGINE === 'chromium') {
    await runTest(CAT, 'touch (CDP): drag a grip with touch-action: none and drop', async () => {
      const { order, center, done } = await setup()
      try {
        const [x, y] = center('.task[data-id="1"] .grip'), [, y4] = center('.task[data-id="4"]')
        const moves = [1, 2, 3, 4, 5, 6].map(i => ['touchMove', x, y + (y4 - y) * i / 6])
        await input([['touchStart', x, y], ...moves, ['wait', 30], ['touchEnd'], ['wait', 60]])
        await waitFor(() => order() === '2,3,4,1')
      } finally { done() }
    }, 6000)
  }

  await runTest(CAT, 'keyboard: Space lifts, arrows move, Enter drops; focus stays on the moved grip', async () => {
    const { id, q, order, done } = await setup()
    try {
      await window.__pw('focus', `${id} .task[data-id="2"] .grip`)
      await input([['key', 'Space']])
      await waitFor(() => q('.task[data-id="2"]').classList.contains('dragging'))
      assert(/Use the arrow keys/.test(q('.announce').textContent), 'keyboard lift instructions announced')
      await input([['key', 'ArrowDown']])
      await waitFor(() => order() === '1,3,2,4')
      await waitFor(() => document.activeElement === q('.task[data-id="2"] .grip'), 1000)
      await input([['key', 'ArrowDown']])
      await waitFor(() => order() === '1,3,4,2')
      await waitFor(() => document.activeElement === q('.task[data-id="2"] .grip'), 1000)
      assert(q('.announce').textContent === 'Build prototype: position 4 of 4.', 'move announced')
      await input([['key', 'Home']])
      await waitFor(() => order() === '2,1,3,4')
      await waitFor(() => document.activeElement === q('.task[data-id="2"] .grip'), 1000)
      await input([['key', 'End'], ['wait', 30], ['key', 'Enter']])
      await waitFor(() => !q('.dragging'))
      await waitFor(() => q('.dropped').textContent)
      assert(order() === '1,3,4,2', 'final order ' + order())
      assert(q('.dropped').textContent === '2:tasks1->tasks3', 'one DROPPED for the whole move: ' + q('.dropped').textContent)
      assert(document.activeElement === q('.task[data-id="2"] .grip'), 'focus after drop')
      assert(window.scrollY === 0, 'Space / arrows did not scroll the page')
    } finally { done() }
  }, 6000)

  await runTest(CAT, 'keyboard: Escape restores the original position and keeps focus', async () => {
    const { id, q, order, done } = await setup()
    try {
      await window.__pw('focus', `${id} .task[data-id="3"] .grip`)
      await input([['key', 'Enter'], ['wait', 20], ['key', 'ArrowUp'], ['wait', 20], ['key', 'ArrowUp']])
      await waitFor(() => order() === '3,1,2,4')
      await input([['key', 'Escape']])
      await waitFor(() => order() === '1,2,3,4')
      await waitFor(() => document.activeElement === q('.task[data-id="3"] .grip'), 1000)
      assert(/^Reorder cancelled\. Test it is back at position 3 of 4\./.test(q('.announce').textContent), 'cancel announced')
      assert(q('.dropped').textContent === '', 'no DROPPED on cancel')
    } finally { done() }
  }, 6000)

  await runTest(CAT, 'keyboard: Tab drops where the item is and moves focus on', async () => {
    const { id, q, order, done } = await setup()
    try {
      await window.__pw('focus', `${id} .task[data-id="4"] .grip`)
      await input([['key', 'Space'], ['wait', 20], ['key', 'ArrowUp']])
      await waitFor(() => order() === '1,2,4,3')
      await waitFor(() => document.activeElement === q('.task[data-id="4"] .grip'), 1000)
      await input([['key', TAB]])
      await waitFor(() => !q('.dragging'))
      await waitFor(() => q('.dropped').textContent === '4:tasks3->tasks2')
      assert(document.activeElement !== q('.task[data-id="4"] .grip'), 'focus moved on')
    } finally { done() }
  }, 6000)

  await runTest(CAT, 'keyboard: a click elsewhere drops a keyboard drag', async () => {
    const { id, q, order, done } = await setup()
    try {
      await window.__pw('focus', `${id} .task[data-id="1"] .grip`)
      await input([['key', 'Space'], ['wait', 20], ['key', 'ArrowDown']])
      await waitFor(() => order() === '2,1,3,4')
      await window.__pw('click', `${id} .after`)
      await waitFor(() => !q('.dragging'))
      await waitFor(() => q('.dropped').textContent === '1:tasks0->tasks1')
    } finally { done() }
  }, 6000)

  await runTest(CAT, 'a11y: grips are named buttons described by the instructions; a status region announces', async () => {
    const { id, q, done } = await setup()
    try {
      assert(await window.__pw('role', id, { role: 'button', name: 'Reorder Build prototype' }) === 1, 'grip named')
      assert(await window.__pw('role', id, { role: 'status' }) === 1, 'one status region')
      // 3-H G-448: the instructions id is set at the first focus inside the host
      await window.__pw('focus', `${id} .task[data-id="2"] .grip`)
      await waitFor(() => q('p[hidden]').id)
      const help = q('p[hidden]')
      assert(help.id === q('.task[data-id="2"] .grip').getAttribute('aria-describedby'), 'aria-describedby names the instructions: ' + help.id)
      assert(help.id === q('.task[data-id="4"] .grip').getAttribute('aria-describedby'), 'every grip is described')
      // G-455: the engine's accessibility tree (Chromium, CDP) has the description; other engines can't be asked (null)
      const desc = await window.__pw('ax', null, { role: 'button', name: 'Reorder Build prototype', prop: 'description' })
      if (ENGINE === 'chromium') assert(/^Press Space or Enter to pick up a task/.test(desc || ''), 'accessible description: ' + desc)
      else assert(desc === null, 'ax is Chromium-only: ' + desc)
    } finally { done() }
  }, 6000)

  await runTest(CAT, 'keyboard: Space and the arrow keys on a focusable item (no handle) do not scroll its scroll container', async () => {
    const { id, el, q, order, done } = await setup(Rows, 3, '.row')
    try {
      // a scroll container shorter than the list: Space / ArrowDown would scroll it by default
      el.style.cssText = 'margin: 8px; height: 60px; overflow-y: auto'
      assert(el.scrollHeight > el.clientHeight + 20, `the stage scrolls: ${el.scrollHeight} > ${el.clientHeight}`)
      el.scrollTop = 0
      const y = window.scrollY
      await window.__pw('focus', `${id} .row[data-id="r1"]`)
      await input([['key', 'Space']])
      await waitFor(() => q('.row[data-id="r1"]').classList.contains('dragging'))
      await input([['key', 'ArrowDown']])
      await waitFor(() => order('.row') === 'r2,r1,r3')
      await input([['wait', 50]])
      assert(el.scrollTop === 0, 'the container did not scroll: ' + el.scrollTop)
      await input([['key', 'Space']])
      await waitFor(() => !q('.dragging'))
      await input([['wait', 50]])
      assert(el.scrollTop === 0 && window.scrollY === y, `no scroll: ${el.scrollTop}, ${window.scrollY}`)
      // the check can fail: Space on a focusable element that isn't sortable scrolls its container
      const box = document.createElement('div')
      box.className = 'plain-box'
      box.style.cssText = 'height: 40px; overflow-y: auto'
      box.innerHTML = '<div class="plain" tabindex="0" style="height: 20px">plain</div><div style="height: 300px"></div>'
      el.after(box)
      await window.__pw('focus', '.plain-box .plain')
      await input([['key', 'Space'], ['wait', 150]])
      assert(box.scrollTop > 0, 'a plain Space scrolls its container: ' + box.scrollTop)
    } finally { done() }
  }, 6000)

  await runTest(CAT, 'nested, repeated ids (3-H G-444): a mouse drag of outer 3 over inner 2 of group 1 lands before group 1', async () => {
    Tree.initialState = { groups: [{ id: 1, children: [{ id: 2 }] }, { id: 2, children: [] }, { id: 3, children: [] }] }
    const { el, center, done } = await setup(Tree, 3, '.group')
    try {
      const groups = () => [...el.querySelectorAll('.group')].map(e => e.dataset.id).join()
      const [x, y] = center('.group[data-id="3"] > .grip'), [lx, ly] = center('.group[data-id="1"] .leaf[data-id="2"]')
      await input([['move', x, y], ['down'], ['move', x, y - 3], ['move', lx, ly, 8], ['wait', 50], ['up']])
      await waitFor(() => groups() === '3,1,2').catch(() => { throw new Error('order: ' + groups()) })
      assert(el.querySelector('.group[data-id="1"] .leaf[data-id="2"]'), 'group 1 keeps its leaf')
    } finally { done() }
  }, 6000)

  await runTest(CAT, 'nested, repeated ids (3-H G-445): Space on outer group 3 lifts it, arrows move it, focus stays on its grip', async () => {
    Tree.initialState = { groups: [{ id: 1, children: [{ id: 3 }] }, { id: 2, children: [] }, { id: 3, children: [] }] }
    const { id, el, q, done } = await setup(Tree, 3, '.group')
    try {
      const groups = () => [...el.querySelectorAll('.group')].map(e => e.dataset.id).join()
      const grip = () => q('.group[data-id="3"] > .grip')
      await window.__pw('focus', `${id} .group[data-id="3"] > .grip`)
      await input([['key', 'Space'], ['wait', 50]])
      assert(document.activeElement === grip(), 'focus stayed on the outer grip: ' + document.activeElement?.outerHTML.slice(0, 80))
      await input([['key', 'ArrowUp']])
      await waitFor(() => groups() === '1,3,2')
      await waitFor(() => document.activeElement === grip(), 1000)
      await input([['key', 'ArrowUp']])
      await waitFor(() => groups() === '3,1,2')
      await waitFor(() => document.activeElement === grip(), 1000)
      await input([['key', 'Enter']])
      assert(q('.group[data-id="1"] .leaf[data-id="3"]'), 'the inner 3 stayed in group 1')
    } finally { done() }
  }, 6000)

  await runTest(CAT, 'two lists (3-H G-454): a mouse drop on the lower half of the other list\'s last item lands after it', async () => {
    const { el, q, center, done } = await setup(Board, 2, '.card')
    try {
      const ids = (s) => [...el.querySelectorAll(`${s} .card`)].map(e => e.dataset.id).join()
      // b into done first (the empty list), then a below b's middle
      let [x, y] = center('.card[data-id="b"] .grip'), [dx, dy] = center('.done')
      await input([['move', x, y], ['down'], ['move', x + 3, y + 3], ['move', dx, dy, 8], ['wait', 50], ['up']])
      await waitFor(() => ids('.done') === 'b')
      ;[x, y] = center('.card[data-id="a"] .grip')
      const r = q('.card[data-id="b"]').getBoundingClientRect()
      await input([['move', x, y], ['down'], ['move', x + 3, y + 3], ['move', r.x + 40, r.y + r.height * 0.8, 8], ['wait', 50]])
      await waitFor(() => q('.card[data-id="b"]') && q('.dragging'))
      await input([['up']])
      await waitFor(() => ids('.done') === 'b,a').catch(() => { throw new Error('done: ' + ids('.done')) })
    } finally { done() }
  }, 6000)

  await runTest(CAT, 'two lists: a mouse drag onto the empty list appends; ArrowRight moves the other one over by keyboard', async () => {
    const { id, el, q, center, done } = await setup(Board, 2, '.card')
    try {
      const ids = (s) => [...el.querySelectorAll(`${s} .card`)].map(e => e.dataset.id).join()
      const [x, y] = center('.card[data-id="a"] .grip'), [dx, dy] = center('.done')
      await input([['move', x, y], ['down'], ['move', x + 3, y + 3], ['move', dx, dy, 8], ['wait', 50]])
      await waitFor(() => q('.dragging')).catch(() => { throw new Error('no drag: ' + q('.announce').textContent) })
      await input([['up']])
      await waitFor(() => ids('.done') === 'a').catch(() => { throw new Error('not dropped in done: ' + ids('.done') + ' / ' + q('.announce').textContent + ' at ' + document.elementFromPoint(dx, dy)?.outerHTML.slice(0, 80)) })
      assert(ids('.todo') === 'b', 'todo: ' + ids('.todo'))
      await window.__pw('focus', `${id} .card[data-id="b"] .grip`)
      await input([['key', 'Space'], ['wait', 20], ['key', 'ArrowRight']])
      // the same index in the next list
      await waitFor(() => ids('.done') === 'b,a')
      await waitFor(() => document.activeElement === q('.card[data-id="b"] .grip'), 1000)
      assert(q('.announce').textContent === 'B: done, position 1 of 2.', 'move announced: ' + q('.announce').textContent)
      await input([['key', 'Enter']])
      await waitFor(() => !q('.dragging'))
    } finally { done() }
  }, 6000)
}
