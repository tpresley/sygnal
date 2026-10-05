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

const input = (steps) => window.__pwInput(steps)

export async function sortableTestsP5_3D() {
  if (typeof window.__pwInput !== 'function') return
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
      const help = q('p[hidden]')
      assert(help.id && help.id === q('.grip').getAttribute('aria-describedby'), 'aria-describedby names the instructions: ' + help.id)
      const desc = await window.__pw('ax', null, { role: 'button', name: 'Reorder Build prototype', prop: 'description' })
      assert(desc === null || /^Press Space or Enter to pick up a task/.test(desc), 'accessible description: ' + desc)
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
