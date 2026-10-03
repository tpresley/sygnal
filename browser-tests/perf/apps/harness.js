// In-page measurement harness, shared by every scenario app (Sygnal, React, Vue).
// run-perf.mjs drives it through window.__perf.measure(op).
//
// Method, per measured operation:
//   0. quiet(): wait until the previous op's trailing work is over (100 ms, then
//      three idle callbacks in a row with ≥ 10 ms of idle time left).
//   1. gc() (Chromium runs with --expose-gc), then wait two animation frames.
//   2. t0 = performance.now(); target.click()   (a real, synchronous DOM click event)
//   3. A MutationObserver on #app (childList + characterData, subtree) re-checks the
//      op's "done" predicate after every batch of mutations (and once right after
//      click() returns, for frameworks that patch synchronously).
//   4. When the predicate holds: read document.body.offsetHeight to force style and
//      layout, then tDom = performance.now().  dom = tDom - t0
//      ("event → DOM settled + layout": script, framework scheduling, diff, patch,
//      style and layout).
//   5. Then requestAnimationFrame → MessageChannel message: tPaint is just after the
//      next frame was produced.  paint = tPaint - t0 ("event → next frame"; it is
//      quantised by the frame clock, so it is the noisier of the two).
//   6. Then the first idle callback with ≥ 10 ms left: busy = tIdle - t0 ("event →
//      main thread idle": includes work a framework does after the DOM is right,
//      such as wiring up new components; an upper bound, since an idle callback
//      can only run after the frame).
const OPS = {
  clear: {
    target: () => document.querySelector('#clear'),
    prepare: () => null,
    done: () => rowCount() === 0,
  },
  create: {
    target: () => document.querySelector('#run'),
    prepare: () => null,
    done: () => rowCount() === 1000,
  },
  // Edit one row: click the 501st row's label; that row's label gains ' !!!'.
  edit: {
    target: () => rowAt(500).querySelector('.lbl'),
    prepare: () => ({ id: rowAt(500).dataset.id, text: rowAt(500).querySelector('.lbl').textContent + ' !!!' }),
    done: (ctx) => {
      const row = rows().querySelector(`[data-id="${ctx.id}"]`)
      return !!row && row.querySelector('.lbl').textContent === ctx.text
    },
  },
  // Swap rows 2 and 999 (js-framework-benchmark's swap).
  swap: {
    target: () => document.querySelector('#swaprows'),
    prepare: () => ({ a: rowAt(1).dataset.id, b: rowAt(998).dataset.id }),
    done: (ctx) => rowAt(1)?.dataset.id === ctx.b && rowAt(998)?.dataset.id === ctx.a,
  },
  append: {
    target: () => document.querySelector('#add'),
    prepare: () => ({ count: rowCount() + 1000 }),
    done: (ctx) => rowCount() === ctx.count,
  },
}

function rows() { return document.querySelector('#app .rows') }
function rowCount() { const r = rows(); return r ? r.children.length : 0 }
function rowAt(i) { return rows().children[i] }

const frame = () => new Promise((resolve) => requestAnimationFrame(() => resolve()))
const afterFrame = () => new Promise((resolve) => requestAnimationFrame(() => {
  const channel = new MessageChannel()
  channel.port1.onmessage = () => resolve()
  channel.port2.postMessage(0)
}))

// Resolves with the time of the first idle callback that has at least 10 ms of
// idle time left: the main thread has no framework work queued for this frame.
const idle = () => new Promise((resolve) => requestIdleCallback(function cb(deadline) {
  if (deadline.timeRemaining() >= 10) resolve(performance.now())
  else requestIdleCallback(cb)
}))

// Before an op: 100 ms, then three idle callbacks in a row with ≥ 10 ms left.
// Without it an op's measurement would include the previous op's trailing work
// (Sygnal's Collection keeps working for tens of ms after its DOM settles).
async function quiet() {
  await new Promise((resolve) => setTimeout(resolve, 100))
  for (let i = 0; i < 3; i++) await idle()
}

async function measure(name, profile = false) {
  const op = OPS[name]
  if (!op) throw new Error(`unknown op ${name}`)
  await quiet()
  const ctx = op.prepare()
  if (typeof globalThis.gc === 'function') globalThis.gc()
  await frame()
  await frame()
  const target = op.target()
  if (!target) throw new Error(`${name}: no target element`)

  const tDom = await new Promise((resolve, reject) => {
    let finished = false
    const check = () => {
      if (finished || !op.done(ctx)) return
      finished = true
      observer.disconnect()
      clearTimeout(timer)
      void document.body.offsetHeight // force style + layout
      resolve(performance.now())
    }
    const observer = new MutationObserver(check)
    observer.observe(document.querySelector('#app'), { childList: true, characterData: true, subtree: true })
    const timer = setTimeout(() => {
      observer.disconnect()
      reject(new Error(`${name}: DOM never reached the expected state`))
    }, 10000)
    if (profile) console.profile(name) // run-perf.mjs --profile: CPU profile from the click to the next frame
    t0 = performance.now()
    target.click()
    check()
  })
  const dom = tDom - t0
  await afterFrame()
  const paint = performance.now() - t0
  const busy = (await idle()) - t0
  if (profile) console.profileEnd(name)
  return { dom, paint, busy }
}
let t0 = 0

window.__perf = {
  ready: () => !!document.querySelector('#app #run') && !!rows(),
  ops: Object.keys(OPS),
  measure,
}
