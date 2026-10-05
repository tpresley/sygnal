// PLAN-5 1-S in a real browser (each engine): D205 (ABORT on typing restores a controlled field,
// native and form-associated custom element; ABORT on a click renders nothing).
import { run, ABORT } from 'sygnal'
import { mount, assert, runTest, wait, waitFor } from '../harness.js'

const CAT = 'Fixes (PLAN-5 1-S)'

async function start(App) {
  const { id, el } = mount()
  const app = run(App, {}, { mountPoint: id })
  await waitFor(() => el.firstElementChild)
  await wait(30)
  return { el, id, app }
}

async function typeKeys(selector, text, delay = 0) {
  if (window.__pwType) return window.__pwType(selector, text, delay)
  const input = document.querySelector(selector)
  for (const ch of text) {
    input.value += ch
    input.dispatchEvent(new InputEvent('input', { bubbles: true, data: ch, inputType: 'insertText' }))
    await new Promise(r => setTimeout(r, delay))
  }
}

if (!customElements.get('p5s-num')) {
  customElements.define('p5s-num', class extends HTMLElement {
    static formAssociated = true
    constructor() { super(); this._v = '' }
    get value() { return this._v }
    set value(v) { this._v = String(v); this.textContent = this._v }
  })
}

let views = 0
function Pin({ state }) {
  views++
  return (
    <div>
      <input className="pin" value={state.pin} />
      <p5s-num className="num" value={state.pin} />
      <button className="noop">noop</button>
    </div>
  )
}
Pin.initialState = { pin: '' }
Pin.intent = ({ DOM }) => ({
  PIN: DOM.input('.pin').value(),
  NUM: DOM.select('.num').events('input').map(e => e.target.value),
  NOOP: DOM.click('.noop'),
})
const digits = (s, pin) => /^\d*$/.test(pin) ? { ...s, pin } : ABORT
Pin.model = { PIN: digits, NUM: digits, NOOP: () => ABORT }

export async function fixesTestsP5_1S() {
  await runTest(CAT, 'D205: typed letters refused with ABORT never stay in a controlled input', async () => {
    const { el, id, app } = await start(Pin)
    try {
      await typeKeys(`${id} .pin`, '1a2b3')
      await waitFor(() => el.querySelector('.pin').value === '123', 2000)
      await wait(30)
      assert(el.querySelector('.pin').value === '123', `value: ${el.querySelector('.pin').value}`)
    } finally { app.dispose() }
  }, 10000)

  await runTest(CAT, 'D205: a form-associated custom element refused with ABORT gets the state value back', async () => {
    const { el, app } = await start(Pin)
    try {
      const num = el.querySelector('.num')
      num.value = '7'
      num.dispatchEvent(new Event('input', { bubbles: true }))
      await waitFor(() => num.value === '7', 1000)
      num.value = 'x'
      num.dispatchEvent(new Event('input', { bubbles: true }))
      await waitFor(() => num.value === '7', 1000)
    } finally { app.dispose() }
  }, 10000)

  await runTest(CAT, 'D205: ABORT from a click renders nothing', async () => {
    const { el, app } = await start(Pin)
    try {
      const before = views
      el.querySelector('.noop').click()
      el.querySelector('.noop').click()
      await wait(50)
      assert(views === before, `views ${before} → ${views}`)
    } finally { app.dispose() }
  }, 10000)
}
