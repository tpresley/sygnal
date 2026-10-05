// PLAN-5 2-R: fixes from the 2-B review in a real browser. G-385: lazy(…, { when: 'visible' })
// inside a Suspense boundary that is on screen loads only when its placeholder is seen (the
// placeholder stays in its own place); G-391: the runner resets the browser context after each
// suite (the first suite changes it and doesn't undo it, the second checks).
import { run, lazy, Suspense } from 'sygnal'
import { mountOnScreen, clearStage, assert, runTest, wait, waitFor } from '../harness.js'

const CAT = 'Fixes (PLAN-5 2-R)'
const pw = (...a) => window.__pwBrowser(...a)

function Chart({ title }) { return <h2 className="chart">{title}</h2> }
const counted = () => { const c = { n: 0 }; c.load = () => { c.n++; return new Promise(r => setTimeout(() => r({ default: Chart }), 30)) }; return c }

export async function fixesTestsP5_2R() {
  await runTest(CAT, "G-385: lazy when 'visible' below the fold inside an on-screen Suspense boundary loads only once seen", async () => {
    const c = counted()
    const LazyChart = lazy(c.load, { when: 'visible', placeholderHeight: 40 })
    function Page({ state }) {
      return <Suspense fallback={<p className="skeleton">Loading…</p>}>
        <p className="intro">on screen</p>
        {state.far ? <div className="spacer" style={{ height: '5000px' }} /> : null}
        <LazyChart title="Below" />
      </Suspense>
    }
    Page.initialState = { far: true }
    Page.model = { NEAR: (s) => ({ ...s, far: false }) }
    const { id, el } = mountOnScreen()
    const app = run(Page, {}, { mountPoint: id })
    try {
      await waitFor(() => el.querySelector('[data-sygnal-when="visible"]'))
      await wait(200)
      assert(c.n === 0, `not loaded while below the fold (${c.n})`)
      assert(!el.querySelector('.skeleton'), 'the boundary shows its content, not the fallback')
      assert(el.querySelector('.intro'), 'the content above the placeholder is shown')
      const ph = el.querySelector('[data-sygnal-when]')
      assert(ph.getBoundingClientRect().height === 40, `placeholderHeight (${ph.getBoundingClientRect().height})`)
      assert(ph.previousElementSibling?.className === 'spacer', 'the placeholder stays in its own place')
      app.__runtime.dispatch('root', 'NEAR')
      await waitFor(() => el.querySelector('.chart')?.textContent === 'Below')
      assert(c.n === 1, `loaded once (${c.n})`)
      assert(!el.querySelector('.skeleton'), 'the fallback is gone')
    } finally { app.dispose(); clearStage() }
  })

  await runTest(CAT, 'G-391: a suite changes the browser context (offline, dark scheme) and leaves it', async () => {
    await pw('offline', true)
    await pw('emulateMedia', { colorScheme: 'dark', reducedMotion: 'reduce' })
    await waitFor(() => !navigator.onLine)
    assert(matchMedia('(prefers-color-scheme: dark)').matches, 'dark emulated')
  })
}

export async function fixesTestsP5_2R_after() {
  await runTest(CAT, 'G-391: the next suite starts online, without the emulated media', async () => {
    await waitFor(() => navigator.onLine)
    assert(!matchMedia('(prefers-color-scheme: dark)').matches, 'no dark emulation left')
    assert(!matchMedia('(prefers-reduced-motion: reduce)').matches, 'no reduced-motion emulation left')
  })
}
