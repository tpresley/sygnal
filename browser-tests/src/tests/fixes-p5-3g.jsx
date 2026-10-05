// PLAN-5 3-G (BROWSER=chromium|firefox|webkit): review fixes in a real engine.
// - G-436 / D215: fromReact sends aria-* / role / title to the React component: an icon button
//   named by aria-label has that accessible name (Playwright's role query reads the engine's
//   accessibility tree); the host div has none.
// - G-434 / G-435: Combobox with name + form (hidden inputs outside the form) and
//   allowCustomValue (the typed text is submitted), with real typing.
// - G-437: fromReact inside a sygnal/element shadow root unmounts once its <Transition> leave ends.
import { run, Transition } from 'sygnal'
import { defineElement } from 'sygnal/element'
import { Combobox } from 'sygnal/ui/combobox'
import { fromReact } from 'sygnal/react'
import { createElement as r, useEffect } from 'react'
import { mountOnScreen, clearStage, assert, runTest as run_, wait, waitFor } from '../harness.js'

const CAT = 'Review fixes (PLAN-5 3-G)'
const hasPw = () => typeof window.__pw === 'function'
const runTest = (name, fn, ms = 8000) => run_(CAT, name, async () => {
  if (!hasPw()) return
  window.scrollTo(0, 0)
  try { await fn() } finally { clearStage() }
}, ms)

function IconButton({ icon, onPress, ...rest }) {
  return r('button', { type: 'button', ...rest, onClick: () => onPress?.() },
    r('svg', { 'aria-hidden': 'true', width: 16, height: 16, 'data-icon': icon }, r('rect', { width: 16, height: 16 })))
}
const Icon = fromReact(IconButton, { events: { press: 'onPress' } })

function Row({ state }) {
  return (
    <div>
      <Icon className="del" icon="trash" aria-label="Delete row" title="Delete" data-row="7" />
      <output className="n">{state.n}</output>
    </div>
  )
}
Row.initialState = { n: 0 }
Row.intent = ({ DOM }) => ({ PRESS: DOM.select('.del').events('press') })
Row.model = { PRESS: (state) => ({ n: state.n + 1 }) }

const CITIES = [{ value: 'par', label: 'Paris' }, { value: 'lis', label: 'Lisbon' }]
function Trip() {
  return (
    <div>
      <form id="p3g-trip" className="trip" />
      <Combobox className="city" label="City" name="city" form="p3g-trip" items={CITIES} allowCustomValue />
    </div>
  )
}

export async function fixesTestsP5_3G() {
  await runTest('fromReact: an icon button named by aria-label has that accessible name (D215)', async () => {
    const { id, el } = mountOnScreen()
    const app = run(Row, {}, { mountPoint: id })
    try {
      await waitFor(() => el.querySelector('.del button'))
      assert(await window.__pw('role', id, { role: 'button', name: 'Delete row' }) === 1, 'no button named "Delete row"')
      const host = el.querySelector('.del')
      assert(!host.hasAttribute('aria-label') && !host.hasAttribute('title'), 'naming props left on the host')
      assert(host.dataset.row === '7' && el.querySelector('.del button').dataset.row === '7', 'data-* on both')
      await window.__pw('click', `${id} .del button`)
      await waitFor(() => el.querySelector('.n').textContent === '1')
    } finally { app.dispose() }
  })

  await runTest('Combobox: form attribute on the hidden input; allowCustomValue submits the typed text (G-434, G-435)', async () => {
    const { id, el } = mountOnScreen()
    const app = run(Trip, {}, { mountPoint: id })
    try {
      await waitFor(() => el.querySelector('.city input[type=hidden]'))
      const form = el.querySelector('.trip')
      assert(el.querySelector('.city input[type=hidden]').form === form, 'hidden input not in the form')
      await window.__pwType(`${id} .city [data-part=input]`, 'Rome')
      await waitFor(() => new FormData(form).get('city') === 'Rome', 2000)
      await window.__pw('press', `${id} .city [data-part=input]`, 'Escape')
      await window.__pw('mouse-away')
      await wait(50)
      assert(new FormData(form).get('city') === 'Rome', `submitted ${new FormData(form).get('city')}`)
    } finally { app.dispose() }
  })

  await runTest('fromReact in a sygnal/element shadow root: unmounted once the leave ends (G-437)', async () => {
    const log = []
    const W = fromReact(function Hello() {
      useEffect(() => { log.push('mount'); return () => log.push('unmount') }, [])
      return r('span', { className: 'hi' }, 'hello')
    })
    function Panel({ state }) {
      return (
        <div>
          {state.on ? <Transition name="p3g" duration={120}><W className="w" /></Transition> : null}
          <button className="t">t</button>
        </div>
      )
    }
    Panel.initialState = { on: true }
    Panel.intent = ({ DOM }) => ({ T: DOM.click('.t') })
    Panel.model = { T: (state) => ({ on: !state.on }) }
    defineElement('p5-3g-panel', Panel, { shadow: true })
    const { el } = mountOnScreen()
    const host = el.appendChild(document.createElement('p5-3g-panel'))
    await waitFor(() => host.shadowRoot?.querySelector('.w .hi'))
    host.shadowRoot.querySelector('.t').click()
    await wait(30)
    assert(log.join() === 'mount', `leaving: ${log}`)
    await waitFor(() => log.join() === 'mount,unmount', 2000)
    host.remove()
  })
}
