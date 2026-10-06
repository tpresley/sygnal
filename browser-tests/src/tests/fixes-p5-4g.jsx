// PLAN-5 4-G (BROWSER=chromium|firefox|webkit): fixes in a real engine.
// - G-553: <option value=""> keeps its value attribute (the props module's create hook runs
//   before the option text is appended), so a placeholder option submits '' and not its label;
//   value="0" / value={0} submit '0'; value={''} updates.
import { run } from 'sygnal'
import { mountOnScreen, clearStage, assert, runTest as run_, waitFor } from '../harness.js'

const CAT = 'Fixes (PLAN-5 4-G)'
const runTest = (name, fn, ms = 8000) => run_(CAT, name, async () => {
  window.scrollTo(0, 0)
  try { await fn() } finally { clearStage() }
}, ms)

function Picks({ state }) {
  return (
    <form className="frm">
      <select name="a"><option value="">Pick one</option><option value="x">X</option></select>
      <select name="b"><option value="0">Zero</option><option value="1">One</option></select>
      <select name="c"><option value={0}>Zero (number)</option></select>
      <select name="d"><option className="dyn" value={state.v}>Label</option></select>
      <button className="clear" type="button">clear</button>
      <button className="set" type="button">set</button>
    </form>
  )
}
Picks.initialState = { v: 'x' }
Picks.intent = ({ DOM }) => ({ CLEAR: DOM.click('.clear'), SET: DOM.click('.set') })
Picks.model = { CLEAR: () => ({ v: '' }), SET: () => ({ v: 'y' }) }

export async function fixesTestsP5_4G() {
  await runTest('<option value=""> submits "" and value="0" submits "0" (G-553)', async () => {
    const { id, el } = mountOnScreen()
    const errors = []
    const app = run(Picks, {}, { mountPoint: id, onError: (e) => errors.push(e) })
    try {
      await waitFor(() => el.querySelector('.frm'))
      const form = el.querySelector('.frm'), data = () => Object.fromEntries(new FormData(form))
      const first = el.querySelector('select[name=a] option')
      assert(first.getAttribute('value') === '', `value attribute ${first.getAttribute('value')}`)
      const d = data()
      assert(d.a === '' && d.b === '0' && d.c === '0' && d.d === 'x', JSON.stringify(d))
      // the user picks X, then the placeholder again
      const sel = el.querySelector('select[name=a]')
      sel.value = 'x'
      assert(data().a === 'x', 'picked X')
      sel.selectedIndex = 0
      assert(data().a === '', `placeholder again: ${data().a}`)
      el.querySelector('.clear').click()
      await waitFor(() => el.querySelector('.dyn').getAttribute('value') === '')
      assert(data().d === '', `value={''} after the update: ${data().d}`)
      el.querySelector('.set').click()
      await waitFor(() => data().d === 'y')
      assert(errors.length === 0, String(errors[0]))
    } finally { app.dispose() }
  })
}
