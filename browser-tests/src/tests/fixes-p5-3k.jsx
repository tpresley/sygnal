// PLAN-5 3-K (BROWSER=chromium|firefox|webkit): fixes in a real engine.
// - G-463: `form` / `list` (getter-only DOM properties) render as attributes and update.
// - G-468: Combobox `allowCustomValue` with selectionBehavior 'preserve' submits the picked value,
//   then the text typed after it, with real typing.
import { run } from 'sygnal'
import { Combobox } from 'sygnal/ui/combobox'
import { mountOnScreen, clearStage, assert, runTest as run_, wait, waitFor } from '../harness.js'

const CAT = 'Fixes (PLAN-5 3-K)'
const hasPw = () => typeof window.__pw === 'function'
const runTest = (name, fn, ms = 8000) => run_(CAT, name, async () => {
  window.scrollTo(0, 0)
  try { await fn() } finally { clearStage() }
}, ms)

function Fields({ state }) {
  return (
    <div>
      <form id={state.f} className="frm" />
      <datalist id="p3k-opts"><option value="a" /></datalist>
      <input className="i" form={state.f} list="p3k-opts" />
      <button className="b" type="submit" form={state.f}>Go</button>
      <button className="swap" type="button">swap</button>
    </div>
  )
}
Fields.initialState = { f: 'p3k-one' }
Fields.intent = ({ DOM }) => ({ SWAP: DOM.click('.swap') })
Fields.model = { SWAP: () => ({ f: 'p3k-two' }) }

const CITIES = [{ value: 'par', label: 'Paris' }, { value: 'lis', label: 'Lisbon' }]
function Trip() {
  return (
    <form className="trip">
      <Combobox className="city" label="City" name="city" items={CITIES} allowCustomValue selectionBehavior="preserve" />
    </form>
  )
}

export async function fixesTestsP5_3K() {
  await runTest('<input form list> and <button form> render and update (G-463)', async () => {
    const { id, el } = mountOnScreen()
    const errors = []
    const app = run(Fields, {}, { mountPoint: id, onError: (e) => errors.push(e) })
    try {
      await waitFor(() => el.querySelector('.i'))
      assert(el.querySelector('.i').form?.id === 'p3k-one', 'input.form')
      assert(el.querySelector('.i').list?.id === 'p3k-opts', 'input.list')
      assert(el.querySelector('.b').form?.id === 'p3k-one', 'button.form')
      el.querySelector('.swap').click()
      await waitFor(() => el.querySelector('.i').getAttribute('form') === 'p3k-two')
      assert(el.querySelector('.b').form?.id === 'p3k-two', 'button.form after the update')
      assert(errors.length === 0, String(errors[0]))
    } finally { app.dispose() }
  })

  await runTest("Combobox allowCustomValue + selectionBehavior 'preserve': the picked value, then typed text (G-468)", async () => {
    if (!hasPw()) return
    const { id, el } = mountOnScreen()
    const app = run(Trip, {}, { mountPoint: id })
    try {
      await waitFor(() => el.querySelector('.city input[type=hidden]'))
      const form = el.querySelector('.trip'), input = `${id} .city [data-part=input]`
      await window.__pwType(input, 'Lis')
      await waitFor(() => el.querySelector('.city [data-part=item]'), 2000)
      await window.__pw('click', `${id} .city [data-part=item]`)
      await waitFor(() => new FormData(form).get('city') === 'lis', 2000)
      assert(el.querySelector('.city [data-part=input]').value === 'Lis', 'preserve keeps the typed text')
      await window.__pw('fill', input, 'Rome')
      await waitFor(() => new FormData(form).get('city') === 'Rome', 2000)
      await window.__pw('press', input, 'Escape')
      await window.__pw('mouse-away')
      await wait(50)
      assert(new FormData(form).get('city') === 'Rome', `submitted ${new FormData(form).get('city')}`)
    } finally { app.dispose() }
  })
}
