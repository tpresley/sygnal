// Benchmark operations. Each op runs in the page: `setup` (not timed) brings the app to the
// starting state, `act` dispatches the user input, `done` is true once the DOM shows the result.
// Strings are function bodies evaluated in the page with the helpers from HELPERS in scope as `h`.

export const HELPERS = `
window.__h = {
  q: (s) => document.querySelector(s),
  n: (s) => document.querySelectorAll(s).length,
  click(s) { const el = document.querySelector(s); if (!el) throw new Error('no element ' + s); el.click() },
  text: (s) => document.querySelector(s)?.textContent,
  // resolves once pred() is true (checked after every DOM mutation batch)
  waitFor(pred, timeout = 60000) {
    return new Promise((resolve, reject) => {
      if (pred()) return resolve()
      const mo = new MutationObserver(() => { if (pred()) { mo.disconnect(); clearTimeout(t); resolve() } })
      mo.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true })
      const t = setTimeout(() => { mo.disconnect(); reject(new Error('timeout waiting for ' + pred)) }, timeout)
    })
  },
  // One measured op, in ms (method from P-3's browser-tests/perf harness, which this replaces):
  //   1. gc() (Chromium runs with --expose-gc), then two animation frames
  //   2. t0, then act() (a real, synchronous DOM event)
  //   3. dom: a MutationObserver re-checks done() after every mutation batch (and once right
  //      after act(), for synchronous frameworks); once it holds, force style + layout.
  //      dom = event -> DOM settled + layout
  //   4. paint: then rAF -> MessageChannel message, just after the next frame
  //      (quantised by the frame clock: the noisier number)
  //   5. busy: then the first idle callback with >= 10 ms left: event -> main thread idle,
  //      including work done after the DOM is right (floor: about one frame)
  // Call quiet() first (bench.mjs and profile.mjs do), so the previous op's trailing work
  // does not land in this measurement.
  async measure(act, done, timeout = 60000) {
    if (typeof window.gc === 'function') window.gc()
    await this.frame(); await this.frame()
    let t0 = 0
    const tDom = await new Promise((resolve, reject) => {
      let finished = false
      const check = () => {
        if (finished || !done()) return
        finished = true
        document.body.offsetHeight // force style + layout so it is counted
        const t1 = performance.now()
        mo.disconnect(); clearTimeout(t)
        resolve(t1)
      }
      const mo = new MutationObserver(check)
      mo.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true })
      const t = setTimeout(() => { mo.disconnect(); reject(new Error('timeout: ' + done)) }, timeout)
      t0 = performance.now()
      act()
      check()
    })
    await this.afterFrame()
    const tPaint = performance.now()
    const tIdle = await this.idle()
    return { dom: tDom - t0, paint: tPaint - t0, busy: tIdle - t0 }
  },
  frame: () => new Promise(r => requestAnimationFrame(() => r())),
  afterFrame: () => new Promise(r => requestAnimationFrame(() => { const c = new MessageChannel(); c.port1.onmessage = () => r(); c.port2.postMessage(0) })),
  // time of the first idle callback with >= 10 ms left: no framework work queued for this frame
  idle: () => new Promise(r => requestIdleCallback(function cb(d) { if (d.timeRemaining() >= 10) r(performance.now()); else requestIdleCallback(cb) })),
  // the page is quiet: 100 ms, then three idle callbacks in a row with >= 10 ms left
  // (a Collection keeps working for tens of ms, up to ~300 ms, after its DOM settles)
  async quiet() {
    await new Promise(r => setTimeout(r, 100))
    for (let i = 0; i < 3; i++) await this.idle()
  },
  type(sel, ch) {
    const el = document.querySelector(sel)
    // the native setter, so React's value tracker sees a change
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, el.value + ch)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  },
  settle: (ms = 50) => new Promise(r => setTimeout(r, ms)),
}
`

const runRows = (n) => `h.click('#clear'); await h.waitFor(() => h.n('.row') === 0); h.click('#${n === 1000 ? 'run' : 'runlots'}'); await h.waitFor(() => h.n('.row') === ${n}); await h.settle()`

const switchA = `if (h.n('.counter') === 0) { h.click('#create'); await h.waitFor(() => h.n('.pa .counter') === 500) } h.click('#show-a'); await h.waitFor(() => h.n('.pa .counter') === 500); await h.settle()`

export const OPS = {
  table: [
    { name: 'create 1k rows', setup: `h.click('#clear'); await h.waitFor(() => h.n('.row') === 0); await h.settle()`, act: `h.click('#run')`, done: `h.n('.row') === 1000` },
    { name: 'replace 1k rows', setup: `${runRows(1000)}; window.__first = h.text('.row .col-id')`, act: `h.click('#run')`, done: `h.n('.row') === 1000 && h.text('.row .col-id') !== window.__first` },
    { name: 'update every 10th (1k)', setup: runRows(1000), act: `h.click('#update')`, done: `h.text('.row .lbl').endsWith('!!!')` },
    { name: 'select row (1k)', setup: runRows(1000), act: `h.click('.row:nth-child(2) .lbl')`, done: `h.q('.row:nth-child(2)').classList.contains('danger')` },
    { name: 'swap rows (1k)', setup: `${runRows(1000)}; window.__id = h.text('.row:nth-child(999) .col-id')`, act: `h.click('#swaprows')`, done: `h.text('.row:nth-child(2) .col-id') === window.__id` },
    { name: 'remove row (1k)', setup: runRows(1000), act: `h.click('.row:nth-child(2) .remove')`, done: `h.n('.row') === 999` },
    { name: 'create 10k rows', setup: `h.click('#clear'); await h.waitFor(() => h.n('.row') === 0); await h.settle()`, act: `h.click('#runlots')`, done: `h.n('.row') === 10000`, iterations: 4, fresh: true },
    { name: 'append 1k to 1k', setup: runRows(1000), act: `h.click('#add')`, done: `h.n('.row') === 2000` },
    { name: 'clear 1k rows', setup: runRows(1000), act: `h.click('#clear')`, done: `h.n('.row') === 0` },
    // P-3's clear-2k (from the retired browser-tests/perf scenario): clear after an append
    { name: 'clear 2k rows', setup: `${runRows(1000)}; h.click('#add'); await h.waitFor(() => h.n('.row') === 2000); await h.settle()`, act: `h.click('#clear')`, done: `h.n('.row') === 0` },
    { name: 'clear 1k after a select', setup: `${runRows(1000)}; h.click('.row:nth-child(2) .lbl'); await h.waitFor(() => h.q('.row:nth-child(2)').classList.contains('danger')); await h.settle(300)`, act: `h.click('#clear')`, done: `h.n('.row') === 0`, iterations: 5, fresh: true },
    { name: 'select row (10k)', setup: runRows(10000), act: `h.click('.row:nth-child(2) .lbl')`, done: `h.q('.row:nth-child(2)').classList.contains('danger')`, iterations: 4, fresh: true },
  ],
  counters: [
    { name: 'mount 1k components', setup: `h.click('#destroy'); await h.waitFor(() => h.n('.counter') === 0); await h.settle()`, act: `h.click('#create')`, done: `h.n('.counter') === 1000` },
    { name: 'update 1 of 1k', setup: `if (h.n('.counter') !== 1000) { h.click('#create'); await h.waitFor(() => h.n('.counter') === 1000) } await h.settle(); window.__v = h.text('.counter:nth-child(500) .val')`, act: `h.click('.counter:nth-child(500) .inc')`, done: `h.text('.counter:nth-child(500) .val') === String(+window.__v + 1)` },
    { name: 'unmount 1k components', setup: `if (h.n('.counter') !== 1000) { h.click('#create'); await h.waitFor(() => h.n('.counter') === 1000) } await h.settle()`, act: `h.click('#destroy')`, done: `h.n('.counter') === 0` },
  ],
  // PLAN-4.6 R1: the counters ops on 1,000 tag children (no Collection); React: its counters page
  tags: [
    { name: 'mount 1k components (tags)', setup: `h.click('#destroy'); await h.waitFor(() => h.n('.counter') === 0); await h.settle()`, act: `h.click('#create')`, done: `h.n('.counter') === 1000` },
    { name: 'update 1 of 1k (tags)', setup: `if (h.n('.counter') !== 1000) { h.click('#create'); await h.waitFor(() => h.n('.counter') === 1000) } await h.settle(); window.__v = h.text('.counter:nth-child(500) .val')`, act: `h.click('.counter:nth-child(500) .inc')`, done: `h.text('.counter:nth-child(500) .val') === String(+window.__v + 1)` },
    { name: 'unmount 1k components (tags)', setup: `if (h.n('.counter') !== 1000) { h.click('#create'); await h.waitFor(() => h.n('.counter') === 1000) } await h.settle()`, act: `h.click('#destroy')`, done: `h.n('.counter') === 0` },
  ],
  deep: [
    { name: 'leaf update, 30 deep', setup: `await h.waitFor(() => h.q('.leaf')); await h.settle(); window.__v = h.text('.leaf .val')`, act: `h.click('.leaf .inc')`, done: `h.text('.leaf .val') === String(+window.__v + 1)` },
  ],
  // spike 0-S (PLAN-4.6): the hard features, Sygnal current core vs the prototype only
  'coll-calc': [
    { name: 'calc: create 1k rows', setup: `h.click('#clear'); await h.waitFor(() => h.n('.row') === 0); await h.settle()`, act: `h.click('#run')`, done: `h.n('.row') === 1000` },
    { name: 'calc: toggle filter (1k -> 500)', setup: runRows(1000), act: `h.click('#filter')`, done: `h.n('.row') === 500` },
    { name: 'calc: re-sort 1k', setup: `${runRows(1000)}; window.__f = h.text('.row .col-id')`, act: `h.click('#sort')`, done: `h.text('.row .col-id') !== window.__f` },
    { name: 'calc: update every 10th (1k)', setup: runRows(1000), act: `h.click('#update')`, done: `h.text('.bumped') === '100'` },
    { name: 'calc: bump one row (1k)', setup: `${runRows(1000)}; window.__l = h.text('.row:nth-child(2) .len')`, act: `h.click('.row:nth-child(2) .bump')`, done: `h.text('.row:nth-child(2) .len') === String(+window.__l + 1)` },
  ],
  switch: [
    { name: 'switch: show other page (500)', setup: switchA, act: `h.click('#show-b')`, done: `h.n('.pb .counter') === 500` },
    { name: 'switch: show page changed while hidden', setup: `${switchA}; h.click('#bump-b'); window.__b = (window.__b || 0) + 1; await h.settle()`, act: `h.click('#show-b')`, done: `h.n('.pb .counter') === 500 && h.text('.pb .counter .val') === String(window.__b)` },
    { name: 'switch: update 1 of 500 (page hidden)', setup: `${switchA}; window.__v = h.text('.pa .counter:nth-child(250) .val')`, act: `h.click('.pa .counter:nth-child(250) .inc')`, done: `h.text('.pa .counter:nth-child(250) .val') === String(+window.__v + 1)` },
  ],
  fetch: [
    { name: 'fetch: create 1k rows, each fetching', setup: `h.click('#clear'); await h.waitFor(() => h.n('.row') === 0); await h.settle()`, act: `h.click('#run')`, done: `h.text('.loaded') === '1000'` },
    { name: 'fetch: reload one row (1k)', setup: `h.click('#clear'); await h.waitFor(() => h.n('.row') === 0); h.click('#run'); await h.waitFor(() => h.text('.loaded') === '1000'); await h.settle(); window.__d = h.text('.row:nth-child(2) .det')`, act: `h.click('.row:nth-child(2) .reload')`, done: `h.text('.row:nth-child(2) .det') !== window.__d` },
  ],
  // PLAN-4.6 R3: statics (a timer declared per Collection item) and the persist write path
  timers: [
    { name: 'timers: create 1k rows, each declaring a timer', setup: `h.click('#clear'); await h.waitFor(() => h.n('.row') === 0); await h.settle()`, act: `h.click('#run')`, done: `h.n('.row') === 1000` },
    { name: 'timers: toggle one row\'s timer (1k)', setup: `${runRows(1000)}; window.__o = h.text('.row:nth-child(2) .on')`, act: `h.click('.row:nth-child(2) .toggle')`, done: `h.text('.row:nth-child(2) .on') !== window.__o` },
    { name: 'timers: new spec for every 10th row (1k)', setup: `${runRows(1000)}; window.__b = h.text('.bumped')`, act: `h.click('#update')`, done: `h.text('.bumped') === String(+window.__b + 100)` },
  ],
  persist: [
    { name: 'persist: create 1k rows, written', setup: `h.click('#clear'); await h.waitFor(() => h.n('.row') === 0 && !(localStorage.getItem('bench-persist') || '').includes('label')); await h.settle()`, act: `h.click('#run')`, done: `h.n('.row') === 1000 && (localStorage.getItem('bench-persist') || '').split('label').length > 1000` },
    { name: 'persist: change one row of 1k, written', setup: `${runRows(1000)}; await h.waitFor(() => (localStorage.getItem('bench-persist') || '').split('label').length > 1000); window.__l = h.text('.row:nth-child(2) .lbl') + '!'`, act: `h.click('.row:nth-child(2) .bump')`, done: `h.text('.row:nth-child(2) .lbl') === window.__l && localStorage.getItem('bench-persist').includes(JSON.stringify(window.__l))` },
  ],
  input: [
    { name: 'keystroke (1k list)', setup: `await h.waitFor(() => h.q('.draft')); await h.settle(); window.__want = h.q('.draft').value + 'a'`, act: `h.type('.draft', 'a')`, done: `h.text('.echo') === window.__want` },
  ],
}

// app page for a framework + scenario; Sygnal also has the Collection-per-row table
export function pagesFor(fw, scenario) {
  if (fw === 'sygnal' && scenario === 'table') return [['sygnal', 'table'], ['sygnal (Collection)', 'table-coll']]
  if (fw === 'next' && scenario === 'table') return [['next', 'table'], ['next (Collection)', 'table-coll']]
  if (scenario === 'tags') return fw === 'vue' ? [] : [[fw, fw === 'react' ? 'counters' : 'counters-tags']]
  if (['coll-calc', 'switch', 'fetch', 'timers', 'persist'].includes(scenario) && fw !== 'sygnal' && fw !== 'next') return []
  return [[fw, scenario]]
}
