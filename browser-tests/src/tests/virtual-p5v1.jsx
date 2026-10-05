// PLAN-5 V-1: <VirtualCollection> in a real browser (layout, scrolling, ResizeObserver): the window
// follows the scroll, ELEMENT scrollToIndex / scrollToId jump to a row that isn't rendered yet,
// dynamic row heights are measured (and a jump to a far row lands on it), the keyboard scrolls the
// container, row state in the array survives scrolling out and back, list semantics in the
// accessibility tree, and SYG430 for a container without a bounded height.
import { run, VirtualCollection, getDiagnostics, clearDiagnostics } from 'sygnal'
import { resetChecks } from 'sygnal/diagnostics'
import { mount, mountOnScreen, clearStage, assert, runTest, wait, waitFor } from '../harness.js'

const CAT = 'VirtualCollection (PLAN-5 V-1)'

const rows = (n, f = () => ({})) => Array.from({ length: n }, (_, i) => ({ id: i + 1, label: 'Row ' + (i + 1), ...f(i) }))
const frame = () => new Promise(r => requestAnimationFrame(() => r()))

function Row({ state }) {
  return (
    <div className="row" style={state.lines ? { padding: '4px 0' } : { height: '32px' }}>
      <span className="lbl">{state.label}</span>
      {state.lines ? <p className="body" style={{ margin: 0 }}>{Array.from({ length: state.lines }, (_, i) => <span style={{ display: 'block', height: '20px' }}>line {i + 1}</span>)}</p> : null}
      <button className="bump">{String(state.n || 0)}</button>
    </div>
  )
}
Row.intent = ({ DOM }) => ({ BUMP: DOM.click('.bump') })
Row.model = { BUMP: (s) => ({ ...s, n: (s.n || 0) + 1 }) }

function makeList(data, props = {}, target = 9000) {
  function List({ state }) {
    return (
      <div>
        <VirtualCollection of={Row} from="rows" className="rows" estimateSize={32} aria-label="Rows" style={{ height: '320px' }} {...props} />
        <button className="jump">jump</button>
        <button className="find">find</button>
      </div>
    )
  }
  List.initialState = { rows: data, target }
  List.intent = ({ DOM }) => ({ JUMP: DOM.click('.jump'), FIND: DOM.click('.find') })
  List.model = {
    JUMP: { ELEMENT: (s) => ({ scrollToIndex: '.rows', index: s.target, align: 'start' }) },
    FIND: { ELEMENT: { scrollToId: '.rows', id: 4321, align: 'center' } },
  }
  return List
}

async function start(App, opts = {}, screen = false) {
  const { id, el } = screen ? mountOnScreen() : mount()
  const app = run(App, {}, { mountPoint: id, ...opts })
  await waitFor(() => el.querySelector('.rows .row'))
  await frame(); await wait(30)
  return { el, app, box: el.querySelector('.rows') }
}
// waitFor with the state it saw on timeout
const until = async (pred, what, ms = 2000) => { try { await waitFor(pred, ms) } catch (_) { throw new Error(`timeout: ${what()}`) } }
const labels = (el) => [...el.querySelectorAll('.row .lbl')].map(e => e.textContent)
const rowTop = (box, i) => {
  const r = box.querySelector(`[data-index="${i}"]`)
  return r && Math.round(r.getBoundingClientRect().top - box.getBoundingClientRect().top)
}

export async function virtualTestsP5V1() {
  await runTest(CAT, '10k rows: a window of rows, the spacer as tall as all of them', async () => {
    const { el, app, box } = await start(makeList(rows(10000)))
    const n = el.querySelectorAll('.row').length
    assert(n >= 10 && n <= 20, `rows rendered: ${n}`)
    assert(box.scrollHeight === 320000, `scrollHeight ${box.scrollHeight}`)
    assert(getComputedStyle(box).overflowY === 'auto', 'scrolls itself')
    app.dispose()
  })

  await runTest(CAT, 'scroll by a page: new rows render, the DOM stays bounded', async () => {
    const { el, app, box } = await start(makeList(rows(10000)))
    box.scrollTop = 320
    await waitFor(() => labels(el).includes('Row 11') && rowTop(box, 10) === 0)
    box.scrollTop = 32 * 5000
    await waitFor(() => labels(el).includes('Row 5001'))
    assert(rowTop(box, 5000) === 0, `row 5001 at the top: ${rowTop(box, 5000)}`)
    assert(el.querySelectorAll('.row').length <= 25, 'bounded')
    app.dispose()
  })

  await runTest(CAT, 'ELEMENT { scrollToIndex } jumps to row 9,001 (not rendered before)', async () => {
    const { el, app, box } = await start(makeList(rows(10000)))
    assert(!el.querySelector('[data-index="9000"]'), 'not rendered yet')
    el.querySelector('.jump').click()
    await waitFor(() => rowTop(box, 9000) === 0)
    assert(box.querySelector('[data-index="9000"] .lbl').textContent === 'Row 9001', 'the row')
    app.dispose()
  })

  await runTest(CAT, 'ELEMENT { scrollToId, align: center } centers the row with that id', async () => {
    const { el, app, box } = await start(makeList(rows(10000)))
    el.querySelector('.find').click()
    await waitFor(() => rowTop(box, 4320) !== null)
    await waitFor(() => Math.abs(rowTop(box, 4320) - (160 - 16)) <= 1)
    app.dispose()
  })

  await runTest(CAT, 'dynamic heights: rows are measured; a jump to a far row lands on it', async () => {
    const data = rows(2000, (i) => ({ lines: 1 + (i % 4) }))
    const { el, app, box } = await start(makeList(data, { estimateSize: 40 }, 1500))
    // rendered rows have their real heights: 8 px padding + 20 px per line + label/button line
    const r0 = box.querySelector('[data-index="0"]').getBoundingClientRect().height
    const r3 = box.querySelector('[data-index="3"]').getBoundingClientRect().height
    assert(r3 - r0 === 60, `heights ${r0} / ${r3}`)
    // the second row starts where the first ends (no overlap, no gap)
    await until(() => rowTop(box, 1) === Math.round(r0), () => `row 1 at ${rowTop(box, 1)}, row 0 ${r0} px`)
    el.querySelector('.jump').click()
    // the rows around it are measured on the way: it still ends at the top
    // (within a pixel: WebKit scrolls to whole pixels, the rows' heights are fractional there)
    const near = () => { const r = box.querySelector('[data-index="1500"]'); return r && Math.abs(r.getBoundingClientRect().top - box.getBoundingClientRect().top) <= 1 }
    await until(near, () => `row 1500 at ${rowTop(box, 1500)}; rows ${labels(el).join(',')}`)
    await wait(100)
    assert(near(), `row 1500 stays at the top: ${rowTop(box, 1500)}`)
    app.dispose()
  })

  await runTest(CAT, 'keyboard: the container is focusable; PageDown / End scroll it', async () => {
    const { el, app, box } = await start(makeList(rows(10000)), {}, true)
    await window.__pw('focus', `#${el.id} .rows`)
    assert(document.activeElement === box, 'focused')
    await window.__pwInput([['key', 'PageDown']])
    await waitFor(() => box.scrollTop > 100)
    await window.__pwInput([['key', 'End']])
    await waitFor(() => labels(el).includes('Row 10000'), 3000)
    app.dispose()
    clearStage()
  }, 6000)

  await runTest(CAT, 'row state lives in the array: it survives scrolling out (instance disposed) and back', async () => {
    const { el, app, box } = await start(makeList(rows(10000)))
    el.querySelector('[data-index="2"] .bump').click()
    await waitFor(() => el.querySelector('[data-index="2"] .bump').textContent === '1')
    const first = el.querySelector('[data-index="2"]')
    box.scrollTop = 32 * 3000
    await waitFor(() => !el.querySelector('[data-index="2"]'))
    box.scrollTop = 0
    await waitFor(() => el.querySelector('[data-index="2"]'))
    assert(el.querySelector('[data-index="2"]') !== first, 'a new element (the instance was disposed)')
    assert(el.querySelector('[data-index="2"] .bump').textContent === '1', 'state kept')
    app.dispose()
  })

  await runTest(CAT, 'a11y: a list of listitems with set size and position', async () => {
    const { el, app, box } = await start(makeList(rows(500)), {}, true)
    const items = await window.__pw('role', `#${el.id}`, { role: 'listitem' })
    assert(items === el.querySelectorAll('.row').length, `listitems: ${items}`)
    const lists = await window.__pw('role', `#${el.id}`, { role: 'list', name: 'Rows' })
    assert(lists === 1, 'one list named Rows')
    const r = box.querySelector('[data-index="4"]')
    assert(r.getAttribute('aria-setsize') === '500' && r.getAttribute('aria-posinset') === '5', 'set size / position')
    app.dispose()
    clearStage()
  })

  // PLAN-5 2-S G-401: the row holding the focus stays rendered (and is never moved in the DOM,
  // which blurs it in every engine) while the keyboard scrolls the list past it
  await runTest(CAT, 'G-401: a focused row keeps the focus while the keyboard scrolls it out of view and back', async () => {
    const { el, app, box } = await start(makeList(rows(10000)), {}, true)
    await window.__pw('focus', `#${el.id} [data-index="2"] .bump`)
    const btn = document.activeElement
    assert(btn.closest('[data-index]')?.getAttribute('data-index') === '2', 'the row 3 button is focused')
    let blurs = 0
    btn.addEventListener('blur', () => blurs++)
    // a row at a time first (the window loses rows at its front and gains rows at its end)
    for (let i = 0; i < 6; i++) await window.__pwInput([['key', 'ArrowDown'], ['wait', 30]])
    await window.__pwInput([['key', 'PageDown'], ['wait', 50], ['key', 'PageDown'], ['wait', 50]])
    await until(() => box.scrollTop > 300, () => `scrollTop ${box.scrollTop}, focus ${document.activeElement?.className}`)
    await frame(); await wait(50)
    assert(!labels(el).slice(1).includes('Row 3'), 'scrolled past it (only the pinned row 3 is out of view)')
    assert(document.activeElement === btn && btn.isConnected, `focus kept: ${document.activeElement?.className}`)
    assert(blurs === 0, `no blur: ${blurs}`)
    // the pinned row sits at its own offset (above the window), not in the window's flow
    const top = Math.round(btn.closest('[data-index]').getBoundingClientRect().top - box.querySelector('[data-index]').parentElement.parentElement.getBoundingClientRect().top)
    assert(top === 64, `row 3 at its offset: ${top}`)
    await window.__pwInput([['key', 'Home'], ['wait', 50]])
    await until(() => box.scrollTop < 32, () => `Home: scrollTop ${box.scrollTop}`)
    await frame(); await wait(30)
    assert(document.activeElement === btn && blurs === 0, 'still focused after scrolling back')
    // the focus leaving the list lets the row go
    btn.blur()
    box.scrollTop = 32 * 3000
    await until(() => !btn.isConnected, () => `let go: rows ${labels(el).slice(0, 3)}`)
    app.dispose()
    clearStage()
  }, 6000)

  // PLAN-5 2-S G-395: a container bounded by max-height that fits its rows (taller than the
  // viewport) is not one that grows: every row renders, no SYG430
  await runTest(CAT, 'G-395: max-height above the viewport that fits its rows: every row, no SYG430', async () => {
    resetChecks()
    clearDiagnostics()
    const n = Math.ceil(window.innerHeight / 32) + 10
    const { el, app } = await start(makeList(rows(n), { style: { maxHeight: (n * 32 + 400) + 'px' } }), { diagnostics: 'collect' })
    await until(() => labels(el).length === n, () => `rows ${labels(el).length} of ${n}`)
    await wait(50)
    assert(!getDiagnostics().some(d => d.code === 'SYG430'), 'no SYG430')
    app.dispose()
  })

  // PLAN-5 2-S G-402: rows measured after layout changes don't make a ResizeObserver loop
  await runTest(CAT, 'G-402: growing rows and scrolling cause no ResizeObserver loop error', async () => {
    const errs = []
    const on = (e) => { if (/ResizeObserver/.test(e.message)) { errs.push(e.message); e.preventDefault?.(); e.stopImmediatePropagation?.() } }
    window.addEventListener('error', on, true)
    try {
      function Grow({ state }) {
        return <div className="row"><span className="lbl">{state.label}</span>{Array.from({ length: state.lines || 1 }, () => <p style={{ margin: 0, height: '20px' }}>x</p>)}<button className="bump">+</button></div>
      }
      Grow.intent = ({ DOM }) => ({ GROW: DOM.click('.bump') })
      Grow.model = { GROW: (s) => ({ ...s, lines: (s.lines || 1) + 3 }) }
      function L() { return <VirtualCollection of={Grow} from="rows" className="rows" estimateSize={24} style={{ height: '300px' }} /> }
      L.initialState = { rows: rows(2000) }
      const { el, app, box } = await start(L)
      for (let i = 0; i < 4; i++) { el.querySelectorAll('.row .bump')[i].click(); await frame() }
      for (let y = 0; y < 3000; y += 400) { box.scrollTop = y; await frame() }
      await wait(100)
      assert(errs.length === 0, `errors: ${errs.join(' | ')}`)
      app.dispose()
    } finally { window.removeEventListener('error', on, true) }
  })

  await runTest(CAT, 'SYG430: a container without a bounded height renders the viewport\'s rows, not all', async () => {
    resetChecks()
    clearDiagnostics()
    const { el, app } = await start(makeList(rows(10000), { style: {} }), { diagnostics: 'collect' })
    await waitFor(() => getDiagnostics().some(d => d.code === 'SYG430'))
    const n = el.querySelectorAll('.row').length
    assert(n < Math.ceil(window.innerHeight / 32) + 12, `rows: ${n}`)
    app.dispose()
  })
}
