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
  // ms from dispatching the input until the DOM shows the result and layout is done
  measure(act, done, timeout = 60000) {
    return new Promise((resolve, reject) => {
      let finished = false
      const check = () => {
        if (finished || !done()) return
        finished = true
        document.body.offsetHeight // force style + layout so it is counted
        const t1 = performance.now()
        mo.disconnect(); clearTimeout(t)
        resolve(t1 - t0)
      }
      const mo = new MutationObserver(check)
      mo.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true })
      const t = setTimeout(() => { mo.disconnect(); reject(new Error('timeout: ' + done)) }, timeout)
      const t0 = performance.now()
      act()
      check()
    })
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
    { name: 'clear 1k after a select', setup: `${runRows(1000)}; h.click('.row:nth-child(2) .lbl'); await h.waitFor(() => h.q('.row:nth-child(2)').classList.contains('danger')); await h.settle(300)`, act: `h.click('#clear')`, done: `h.n('.row') === 0`, iterations: 5, fresh: true },
    { name: 'select row (10k)', setup: runRows(10000), act: `h.click('.row:nth-child(2) .lbl')`, done: `h.q('.row:nth-child(2)').classList.contains('danger')`, iterations: 4, fresh: true },
  ],
  counters: [
    { name: 'mount 1k components', setup: `h.click('#destroy'); await h.waitFor(() => h.n('.counter') === 0); await h.settle()`, act: `h.click('#create')`, done: `h.n('.counter') === 1000` },
    { name: 'update 1 of 1k', setup: `if (h.n('.counter') !== 1000) { h.click('#create'); await h.waitFor(() => h.n('.counter') === 1000) } await h.settle(); window.__v = h.text('.counter:nth-child(500) .val')`, act: `h.click('.counter:nth-child(500) .inc')`, done: `h.text('.counter:nth-child(500) .val') === String(+window.__v + 1)` },
    { name: 'unmount 1k components', setup: `if (h.n('.counter') !== 1000) { h.click('#create'); await h.waitFor(() => h.n('.counter') === 1000) } await h.settle()`, act: `h.click('#destroy')`, done: `h.n('.counter') === 0` },
  ],
  deep: [
    { name: 'leaf update, 30 deep', setup: `await h.waitFor(() => h.q('.leaf')); await h.settle(); window.__v = h.text('.leaf .val')`, act: `h.click('.leaf .inc')`, done: `h.text('.leaf .val') === String(+window.__v + 1)` },
  ],
  input: [
    { name: 'keystroke (1k list)', setup: `await h.waitFor(() => h.q('.draft')); await h.settle(); window.__want = h.q('.draft').value + 'a'`, act: `h.type('.draft', 'a')`, done: `h.text('.echo') === window.__want` },
  ],
}

// app page for a framework + scenario; Sygnal also has the Collection-per-row table
export function pagesFor(fw, scenario) {
  if (fw === 'sygnal' && scenario === 'table') return [['sygnal', 'table'], ['sygnal (Collection)', 'table-coll']]
  return [[fw, scenario]]
}
