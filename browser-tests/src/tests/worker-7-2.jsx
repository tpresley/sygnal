// 7.2 W-1 (sygnal/worker, experimental): an app in a real module Web Worker, the page through
// sygnal/worker/page's bridge, with real input (Playwright: window.__pwType, __pw, __pwInput) in
// each engine (BROWSER=chromium|firefox|webkit). Covers the first-version items: declared
// preventDefault (Q-WW-2), a submit held until the last edit is acknowledged (Q-WW-3), the caret
// through a worker write (Q-WW-4), pointermove coalesced per frame (Q-WW-7). The apps:
// src/worker/apps.jsx. Skipped (passes trivially) when the page is opened by hand.
import { startBridge } from 'sygnal/worker/page'
import { mountOnScreen, clearStage, assert, runTest as run_, waitFor } from '../harness.js'

const CAT = 'Web Worker (7.2 W-1)'
const hasPw = () => typeof window.__pw === 'function'
const workers = []
const runTest = (cat, name, fn, ms = 8000) => run_(cat, name, async () => {
  try { await fn() } finally { for (const w of workers.splice(0)) { w.bridge.stop(); w.worker.terminate() } clearStage() }
}, ms)

async function start(app) {
  const { id, el } = mountOnScreen()
  const worker = new Worker(new URL('../worker/apps.jsx', import.meta.url), { type: 'module', name: app })
  const bridge = startBridge(worker, el)
  workers.push({ worker, bridge })
  await bridge.ready
  return { id, el, bridge }
}
const texts = (el, sel) => Array.from(el.querySelectorAll(sel)).map((n) => n.textContent)

export async function workerTests7_2() {
  await runTest(CAT, 'the app renders from the worker, typing and Enter add an item and clear the field', async () => {
    if (!hasPw()) return
    const { id, el } = await start('todos')
    await window.__pwType(`${id} .new`, 'Buy milk', 20)
    await window.__pw('press', `${id} .new`, 'Enter')
    await waitFor(() => texts(el, 'li').join() === 'Buy milk' && el.querySelector('.new').value === '', 3000)
    assert(document.activeElement === el.querySelector('.new'), 'focus stays in the field')
  })

  await runTest(CAT, 'Q-WW-3: words and Enters typed inside one round trip submit what was typed', async () => {
    if (!hasPw()) return
    const { id, el, bridge } = await start('todos')
    // 0 ms per key: the whole sequence lands before the worker answers the first Enter
    await window.__pwType(`${id} .new`, 'Buy milk\nWalk dog\nFeed cat', 0)
    await waitFor(() => texts(el, 'li').join() === 'Buy milk,Walk dog' && el.querySelector('.new').value === 'Feed cat', 4000)
      .catch(() => { throw new Error(`items ${JSON.stringify(texts(el, 'li'))}, field "${el.querySelector('.new').value}"`) })
    await window.__pw('press', `${id} .new`, 'Enter')
    await waitFor(() => texts(el, 'li').join() === 'Buy milk,Walk dog,Feed cat' && el.querySelector('.new').value === '', 3000)
    assert(bridge.stats.held > 0, 'a submit was held')
  })

  await runTest(CAT, 'Q-WW-2: an intent\'s preventDefault pattern keeps Tab in the field, synchronously on the page', async () => {
    if (!hasPw()) return
    const { id, el } = await start('keys')
    await window.__pw('focus', `${id} .tabbed`)
    await window.__pw('press', `${id} .tabbed`, 'Tab')
    await waitFor(() => el.querySelector('.log').textContent === 'Tab', 3000)
    assert(document.activeElement === el.querySelector('.tabbed'), 'Tab was prevented: focus stayed')
    await window.__pw('press', `${id} .tabbed`, 'a')
    await waitFor(() => el.querySelector('.log').textContent === 'Tab,a', 3000)
  })

  await runTest(CAT, 'Q-WW-2: a Collection row\'s preventDefault: true stops its link\'s navigation, not the root\'s', async () => {
    if (!hasPw()) return
    const { id, el } = await start('keys')
    const before = location.hash
    await window.__pw('click', `${id} .go >> nth=1`)
    await waitFor(() => el.querySelector('.log').textContent === 'go2', 3000)
    assert(location.hash === before, `the row link navigated (${location.hash})`)
    await window.__pw('click', `${id} .out`)
    await waitFor(() => location.hash === '#out', 3000)
    history.replaceState(null, '', location.pathname + location.search + before)
  })

  await runTest(CAT, 'Q-WW-4: the caret keeps its place when the worker rewrites the field', async () => {
    if (!hasPw()) return
    const { id, el } = await start('trim')
    const input = el.querySelector('.trim')
    await window.__pwType(`${id} .trim`, '  abcd', 20)
    await waitFor(() => input.value === 'abcd', 3000).catch(() => { throw new Error(`value "${input.value}"`) })
    assert(input.selectionStart === 4, `caret at the end (${input.selectionStart})`)
    // (not Home: on macOS key bindings, Firefox and WebKit don't move the caret with it)
    for (let i = 0; i < 4; i++) await window.__pw('press', `${id} .trim`, 'ArrowLeft')
    await window.__pwType(`${id} .trim`, ' ', 0)
    // ' abcd' → the worker drops the space: the caret stays before 'a'
    await waitFor(() => input.value === 'abcd', 3000).catch(() => { throw new Error(`then "${input.value}"`) })
    await waitFor(() => input.selectionStart === 0, 1000).catch(() => { throw new Error(`caret at ${input.selectionStart}`) })
  })

  await runTest(CAT, 'Q-WW-7: real pointermoves: the last position reaches the worker', async () => {
    if (!hasPw()) return
    const { el } = await start('pad')
    const r = el.querySelector('.pad').getBoundingClientRect()
    const y = Math.round(r.top + 80), x0 = Math.round(r.left)
    const steps = []
    for (let x = 10; x <= 250; x += 5) steps.push(['move', x0 + x, y])
    await window.__pwInput(steps)
    const moves = () => el.querySelector('.moves').textContent.split(':').map(Number)
    await waitFor(() => moves()[1] === x0 + 250, 3000).catch(() => { throw new Error('last position: ' + moves()) })
    assert(moves()[0] >= 1 && moves()[0] <= steps.length, `${moves()[0]} pointermoves for ${steps.length} mouse moves`)
  })

  await runTest(CAT, 'Q-WW-7: a burst of pointermoves and wheels in one task crosses once (the latest; wheel deltas summed)', async () => {
    const { el } = await start('pad')
    const pad = el.querySelector('.pad')
    for (let x = 1; x <= 100; x++) pad.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: x }))
    for (let i = 0; i < 20; i++) pad.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 3 }))
    await waitFor(() => el.querySelector('.moves').textContent === '1:100' && el.querySelector('.wheel').textContent === '1:60', 3000)
      .catch(() => { throw new Error(el.querySelector('.moves').textContent + ' / ' + el.querySelector('.wheel').textContent) })
  })
}
