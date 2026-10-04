// P45-R: phase-review fixes of PLAN-4.5, in a real browser.
// - G-257: a move between Collections whose items have intent + model (a kanban card) is one patch;
//   no frame (and no DOM state) without the moved card.
import { run, Collection } from 'sygnal'
import { mount, assert, runTest, waitFor, wait } from '../harness.js'

const CAT = 'P45-R (review fixes)'

function Card({ state }) {
  return <li className="card"><span>{state.id}</span><button className="up">{String(state.n || 0)}</button></li>
}
Card.intent = ({ DOM }) => ({ UP: DOM.click('.up') })
Card.model = { UP: (s) => ({ ...s, n: (s.n || 0) + 1 }) }

function Lanes({ state }) {
  return (
    <div>
      <ul className="a"><Collection of={Card} from="a" /></ul>
      <ul className="b"><Collection of={Card} from="b" /></ul>
      <p className="n">{state.n}</p>
    </div>
  )
}
Lanes.initialState = { a: [{ id: 'x' }, { id: 'y' }], b: [{ id: 'z' }], n: 0 }
Lanes.intent = ({ DOM }) => ({ MOVE: DOM.select('document').events('p45r-move') })
Lanes.model = { MOVE: (s) => s.a.length ? { ...s, a: s.a.slice(1), b: [...s.b, s.a[0]] } : { ...s, a: [...s.a, s.b[0]], b: s.b.slice(1) } }

async function framesWhere(pred, fn) {
  let on = true, bad = 0, frames = 0
  const tick = () => { if (!on) return; frames++; if (pred()) bad++; requestAnimationFrame(tick) }
  requestAnimationFrame(tick)
  try { await fn() } finally { on = false }
  return { bad, frames }
}

export async function reviewFixesTestsP45R() {
  await runTest(CAT, 'G-257: moving a card with intent + model between lanes never paints a frame without it', async () => {
    const { id, el } = mount()
    const app = run(Lanes, {}, { mountPoint: id })
    await waitFor(() => el.querySelectorAll('.card').length == 3)
    await wait(30)
    let partial = 0
    const mo = new MutationObserver(() => { if (el.querySelectorAll('.card').length != 3) partial++ })
    mo.observe(el, { childList: true, subtree: true })
    try {
      const r = await framesWhere(() => el.querySelectorAll('.card').length != 3, async () => {
        for (let i = 0; i < 10; i++) { document.dispatchEvent(new CustomEvent('p45r-move')); await wait(48) }
        for (let i = 0; i < 10; i++) { document.dispatchEvent(new CustomEvent('p45r-move')); await wait(9) }
        await wait(100)
      })
      assert(r.bad == 0 && partial == 0, `${r.bad} of ${r.frames} frames without the moved card (${partial} partial DOM states)`)
      // the moved card responds at once
      const btn = el.querySelector('.b .card:last-child .up')
      btn.click()
      await waitFor(() => btn.textContent == '1')
    } finally { mo.disconnect(); app.dispose() }
  }, 6000)
}
