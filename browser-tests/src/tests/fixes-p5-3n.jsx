// PLAN-5 3-N (BROWSER=chromium|firefox|webkit): fixes in a real engine.
// - G-498: <VirtualCollection>'s "grows" probe puts the ancestors' overflow-anchor back through the
//   CSSOM: under a CSP that blocks inline styles nothing is wiped or left behind, no violation; a
//   scroller inside a shadow tree the list is slotted into gets anchoring off too.
// - G-489: a View Transition the browser skips (duplicate view-transition-names) leaves no
//   unhandled promise rejection.
import { run, VirtualCollection, Collection, makeViewTransitionDOMDriver } from 'sygnal'
import { mount, mountOnScreen, clearStage, assert, runTest as run_, wait, waitFor } from '../harness.js'

const CAT = 'Fixes (PLAN-5 3-N)'
const runTest = (name, fn, ms = 8000) => run_(CAT, name, fn, ms)
const frame = () => new Promise(r => requestAnimationFrame(() => r()))
const rows = (n) => Array.from({ length: n }, (_, i) => ({ id: i + 1, label: 'Row ' + (i + 1) }))

function Row({ state }) {
  return <div className="row" style={{ height: '32px' }}>{state.label}</div>
}

export async function fixesTestsP5_3N() {
  // ── G-498 ────────────────────────────────────────────────────────────
  await runTest('G-498: the grows probe under a CSP without unsafe-inline styles keeps the ancestors\' styles, no violation', async () => {
    // (on screen: WebKit throttles animation frames in an off-screen frame)
    const { el } = mountOnScreen()
    const f = document.createElement('iframe')
    f.style.width = '600px'
    f.style.height = '400px'
    f.src = '/p5-3n-csp.html'
    el.appendChild(f)
    try {
      await waitFor(() => f.contentWindow?.probeReady, 6000)
      const r = await f.contentWindow.probe()
      assert(r.rows > 0 && r.rows < 40, `the viewport's rows (grows): ${r.rows}`)
      assert(r.after === r.before, `styles: ${r.before} → ${r.after}`)
      assert(r.anchor === 'auto,auto,auto', `overflow-anchor: ${r.anchor}`)
      assert(r.violations.length === 0, `CSP violations: ${r.violations.join('; ')}`)
    } finally { f.remove(); clearStage() }
  }, 10000)

  if (!customElements.get('p53n-scroller')) {
    customElements.define('p53n-scroller', class extends HTMLElement {
      connectedCallback() {
        if (this.shadowRoot) return
        const root = this.attachShadow({ mode: 'open' }), s = document.createElement('div')
        s.className = 'scroller'
        s.style.height = '300px'
        s.style.overflowY = 'auto'
        s.appendChild(document.createElement('slot'))
        root.appendChild(s)
      }
    })
  }
  await runTest('G-498: a scroller in the shadow tree the list is slotted into gets scroll anchoring off during the probe, then back', async () => {
    const { el } = mount()
    const host = document.createElement('p53n-scroller'), point = document.createElement('div')
    host.appendChild(point)
    el.appendChild(host)
    const sc = host.shadowRoot.querySelector('.scroller')
    const seen = []
    const mo = new MutationObserver((recs) => recs.forEach(() => seen.push(1)))
    function List() { return <div><VirtualCollection of={Row} from="rows" className="rows" estimateSize={32} style={{}} /></div> }
    List.initialState = { rows: rows(1000) }
    const app = run(List, {}, { mountPoint: point })
    try {
      await waitFor(() => point.querySelector('.rows .row'))
      await frame(); await wait(30)
      const before = sc.style.cssText
      mo.observe(sc, { attributes: true, attributeFilter: ['style'] })
      const box = point.querySelector('.rows')
      box.style.width = '90%'
      await frame(); await frame(); await wait(30)
      mo.takeRecords().forEach(() => seen.push(1))
      assert(seen.length >= 2, `the shadow scroller's style changed ${seen.length} times`)
      assert(sc.style.cssText === before, `restored: ${before} → ${sc.style.cssText}`)
    } finally { mo.disconnect(); app.dispose(); host.remove() }
  })

  // ── G-489 ────────────────────────────────────────────────────────────
  const Item = ({ state }) => <li className="item">{state.id}</li>
  function Dupes({ state }) {
    return (
      <div>
        <ul className="a"><Collection of={Item} from="items" viewTransitionName="p53n" /></ul>
        <ul className="b"><Collection of={Item} from="items" viewTransitionName="p53n" /></ul>
      </div>
    )
  }
  Dupes.initialState = { items: [{ id: 1 }, { id: 2 }] }
  Dupes.intent = ({ DOM }) => ({ REV: DOM.select('document').events('p53n-rev') })
  Dupes.model = { REV: (s) => ({ ...s, items: [...s.items].reverse() }) }
  Dupes.viewTransitions = ['REV']

  await runTest('G-489: a View Transition skipped for duplicate names leaves no unhandled rejection', async () => {
    const { id, el } = mount()
    const rejections = []
    const on = (e) => { rejections.push(String(e.reason?.name || e.reason)); e.preventDefault() }
    window.addEventListener('unhandledrejection', on)
    const real = document.startViewTransition
    let calls = 0
    document.startViewTransition = function (cb) { calls++; return real.call(document, cb) }
    const app = run(Dupes, { DOM: makeViewTransitionDOMDriver(id) }, { mountPoint: id })
    try {
      await waitFor(() => el.querySelectorAll('.item').length == 4)
      await wait(30)
      document.dispatchEvent(new CustomEvent('p53n-rev'))
      await waitFor(() => calls == 1, 1000)
      await waitFor(() => [...el.querySelectorAll('.a .item')].map(li => li.textContent).join() == '2,1', 1000)
      await wait(200)
      assert(rejections.length == 0, `unhandled rejections: ${rejections.join()}`)
    } finally { document.startViewTransition = real; window.removeEventListener('unhandledrejection', on); app.dispose() }
  })
}
