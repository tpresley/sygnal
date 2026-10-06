// PLAN-5 3-T (BROWSER=chromium|firefox|webkit): fixes in a real engine.
// - G-525: the clamped window of an unbounded <VirtualCollection> follows an ancestor's CSS zoom
//   only (currentCSSZoom), not a transform: under transform: scale(0.02) it stays the viewport's
//   rows (it was 50 viewports: ~940 rows), and once the scale goes the next measure is the same.
import { run, VirtualCollection } from 'sygnal'
import { mount, assert, runTest as run_, wait, waitFor } from '../harness.js'

const CAT = 'Fixes (PLAN-5 3-T)'
const runTest = (name, fn, ms = 8000) => run_(CAT, name, fn, ms)
const frame = () => new Promise(r => requestAnimationFrame(() => r()))
const rows = (n) => Array.from({ length: n }, (_, i) => ({ id: i + 1, label: 'Row ' + (i + 1) }))

function Row({ state }) {
  return <div className="row" style={{ height: '32px' }}>{state.label}</div>
}

export async function fixesTestsP5_3T() {
  // ── G-525 ────────────────────────────────────────────────────────────
  await runTest('G-525: an unbounded list under transform: scale(0.02) renders the viewport\'s rows, and the same once the scale goes', async () => {
    function Scaled() {
      return <div className="wrap" style={{ transform: 'scale(0.02)', transformOrigin: '0 0', width: '400px' }}>
        <VirtualCollection of={Row} from="rows" className="rows" estimateSize={32} />
      </div>
    }
    Scaled.initialState = { rows: rows(20000) }
    const { id, el } = mount()
    const app = run(Scaled, {}, { mountPoint: id })
    try {
      await waitFor(() => el.querySelector('.rows .row'))
      await frame(); await frame(); await wait(50)
      const need = Math.ceil(window.innerHeight / 32)
      const n = el.querySelectorAll('.row').length
      assert(n >= need && n < need + 15, `rows under scale(0.02): ${n} (the viewport shows ${need})`)
      // the scale goes (no resize is observed); the next measure (a width change) is the same
      const w = el.querySelector('.wrap')
      w.style.transform = 'none'
      w.style.width = '401px'
      await frame(); await frame(); await wait(50)
      const m = el.querySelectorAll('.row').length
      assert(m >= need && m < need + 15, `rows without the scale: ${m} (the viewport shows ${need})`)
    } finally { app.dispose() }
  }, 10000)
}
