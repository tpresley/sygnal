// PLAN-4 1-F: events the browser fires without bubbling reach intent. A native <dialog> opened
// with showModal() and closed with close() fires `close` (and requestClose() fires `cancel`) on
// the dialog only; a popover fires `beforetoggle`/`toggle`; a broken <img> fires `error`.
import { run, controls } from 'sygnal'
import { mount, assert, runTest, wait, waitFor } from '../harness.js'

const CAT = 'Non-bubbling events (PLAN-4 1-F)'

const { Help, Pop, Pic } = controls({ Help: 'dialog', Pop: 'div', Pic: 'img' })

function App({ state }) {
  return (
    <div className="wrap">
      <Help><p>Help</p></Help>
      <Pop popover="auto">Pop</Pop>
      <Pic src="data:image/png;base64,AAAA" alt="missing" />
      <p className="log">{state.log.join(',')}</p>
    </div>
  )
}
App.initialState = { log: [] }
App.intent = ({ DOM }) => ({
  CLOSED: DOM.close(Help),
  CANCELLED: DOM.select(Help).events('cancel'),
  BEFORE: DOM.select(Pop).events('beforetoggle'),
  TOGGLE: DOM.select(Pop).events('toggle'),
  ERROR: DOM.select(Pic).events('error'),
  WRAP: DOM.select('.wrap').events('close'),
})
const log = (name) => (s, e) => ({ ...s, log: [...s.log, name + (e && e.newState ? ':' + e.newState : '')] })
App.model = {
  CLOSED: log('close'), CANCELLED: log('cancel'), BEFORE: log('beforetoggle'),
  TOGGLE: log('toggle'), ERROR: log('error'), WRAP: log('wrap'),
}

async function start() {
  const { id, el } = mount()
  const app = run(App, {}, { mountPoint: id })
  await waitFor(() => el.querySelector('.log'))
  await wait(30)
  return { el, app }
}
const logOf = (el) => el.querySelector('.log').textContent

export async function nonBubblingTests1F() {
  await runTest(CAT, 'dialog: real showModal() then close() fires close into intent', async () => {
    const { el, app } = await start()
    try {
      const dlg = el.querySelector(String(Help))
      dlg.showModal()
      assert(dlg.open, 'showModal() opened the dialog')
      dlg.close('done')
      await waitFor(() => logOf(el).includes('close'), 1000)
      assert(logOf(el).split(',').filter(x => x === 'close').length === 1, `one close action: ${logOf(el)}`)
      assert(!logOf(el).includes('wrap'), `the ancestor does not hear close: ${logOf(el)}`)
    } finally { app.dispose() }
  })

  await runTest(CAT, 'dialog: requestClose() fires cancel then close', async () => {
    const { el, app } = await start()
    try {
      const dlg = el.querySelector(String(Help))
      if (typeof dlg.requestClose !== 'function') return // older engine: no programmatic cancel
      dlg.showModal()
      dlg.requestClose()
      await waitFor(() => logOf(el).includes('close'), 1000)
      const got = logOf(el).split(',').filter(x => x === 'cancel' || x === 'close').join()
      assert(got === 'cancel,close', `cancel then close: ${logOf(el)}`)
    } finally { app.dispose() }
  })

  await runTest(CAT, 'popover: showPopover() fires beforetoggle and toggle', async () => {
    const { el, app } = await start()
    try {
      const pop = el.querySelector(String(Pop))
      if (typeof pop.showPopover !== 'function') return
      pop.showPopover()
      await waitFor(() => logOf(el).includes('toggle:open') && logOf(el).includes('beforetoggle:open'), 1000)
      pop.hidePopover()
      await waitFor(() => logOf(el).includes('toggle:closed'), 1000)
    } finally { app.dispose() }
  })

  await runTest(CAT, 'img: a failed load fires error into intent', async () => {
    const { el, app } = await start()
    try {
      await waitFor(() => logOf(el).includes('error'), 1500)
    } finally { app.dispose() }
  })
}
