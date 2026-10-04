// G-213: an item that moves from one Collection to another must never paint a frame without it
// (P-1 measured 0-1 frames per move, 4-8 in rapid runs, with the plain DOM driver).
import { run, Collection } from 'sygnal'
import { mount, assert, runTest, waitFor, wait } from '../harness.js'

const CAT = 'G-213 (cross-Collection move)'

const Item = ({ state }) => <li className="item">{state.id}</li>
function Board({ state }) {
  return (
    <div>
      <ul className="a"><Collection of={Item} from="a" /></ul>
      <ul className="b"><Collection of={Item} from="b" /></ul>
      <p className="n">{state.n}</p>
    </div>
  )
}
Board.initialState = { a: [{ id: 'x' }, { id: 'y' }], b: [{ id: 'z' }], n: 0 }
Board.intent = ({ DOM }) => ({ MOVE: DOM.select('document').events('g213-move') })
Board.model = { MOVE: (s) => s.a.length ? { ...s, a: s.a.slice(1), b: [...s.b, s.a[0]] } : { ...s, a: [...s.a, s.b[0]], b: s.b.slice(1) } }

const fire = (name) => document.dispatchEvent(new CustomEvent(name))

// samples the DOM once per frame (rAF runs right before paint) while fn runs
async function framesWhere(pred, fn) {
  let on = true, bad = 0, frames = 0
  const tick = () => { if (!on) return; frames++; if (pred()) bad++; requestAnimationFrame(tick) }
  requestAnimationFrame(tick)
  try { await fn() } finally { on = false }
  return { bad, frames }
}

export async function g213Tests() {
  await runTest(CAT, 'a cross-Collection move never paints a frame without the item (DOM driver, no transition)', async () => {
    const { id, el } = mount()
    const app = run(Board, {}, { mountPoint: id })
    await waitFor(() => el.querySelector('.n'))
    await wait(30)
    // every DOM state the patches leave, not only the painted ones
    let partial = 0
    const mo = new MutationObserver(() => { if (el.querySelectorAll('.item').length != 3) partial++ })
    mo.observe(el, { childList: true, subtree: true })
    try {
      const r = await framesWhere(() => el.querySelectorAll('.item').length != 3, async () => {
        for (let i = 0; i < 10; i++) { fire('g213-move'); await wait(48) }
        for (let i = 0; i < 10; i++) { fire('g213-move'); await wait(9) }
        await wait(100)
      })
      assert(r.bad == 0, `${r.bad} of ${r.frames} frames without the moved item (${partial} partial DOM states)`)
      assert(el.querySelectorAll('.item').length == 3, 'three items at the end')
    } finally { mo.disconnect(); app.dispose() }
  }, 6000)
}
