// The wizard spike (dev-plans/research/wizard), BROWSER=chromium|firefox|webkit: with real clicks
// and keys, Next moves to a step whose heading gets focus (tabindex=-1 added, not on the first
// mount), the stepper's aria-current follows, Back keeps the step's typed value, and only the
// current step is in the DOM.
import { run, wizard, Outlet, makeRouter } from 'sygnal'
import { dialog, popover } from 'sygnal/ui'
import { mountOnScreen, clearStage, assert, runTest as run_, wait, waitFor } from '../harness.js'

const CAT = 'Wizard spike'
const hasPw = () => typeof window.__pw === 'function'
const runTest = (name, fn, ms = 8000) => run_(CAT, name, async () => {
  if (!hasPw()) return
  window.scrollTo(0, 0)
  try { await fn() } finally { clearStage() }
}, ms)

function One({ state }) {
  return <div className="wz-one"><h2>Your name</h2><label>Name <input className="wz-name" value={state.draft.name} /></label></div>
}
One.intent = ({ DOM }) => ({ NAME: DOM.input('.wz-name').map((e) => e.target.value) })
One.model = { NAME: (s, name) => ({ ...s, draft: { ...s.draft, name } }) }

function Two({ state }) {
  return <div className="wz-two"><h2 data-wizard-focus>Check {state.draft.name}</h2></div>
}

function Flow({ state }) {
  const w = state.wizard
  return (
    <section>
      <ol className="wz-steps" aria-label="Progress">
        {w.steps.map((s) => <li aria-current={s.current ? 'step' : undefined}>{s.label}</li>)}
      </ol>
      <Outlet of={{ one: One, two: Two }} from="wizard" />
      <button className="wz-back" disabled={!w.canBack}>Back</button>
      <button className="wz-next" disabled={!w.canNext}>Next</button>
    </section>
  )
}
Flow.uses = {
  wizard: wizard({
    steps: { one: { label: 'Name', valid: (s) => !!s.draft.name }, two: { label: 'Check' } },
    draft: { name: '' }, next: '.wz-next', back: '.wz-back',
  }),
}

export async function wizardSpikeTests() {
  await runTest('Next focuses the new step heading; aria-current follows; Back keeps the value', async () => {
    const { id, el } = mountOnScreen()
    const app = run(Flow, {}, { mountPoint: id })
    try {
      await waitFor(() => el.querySelector('.wz-name'))
      const current = () => [...el.querySelectorAll('.wz-steps li')].map((l) => l.getAttribute('aria-current'))
      assert(current().join() === 'step,', 'start: ' + current())
      assert(!el.contains(document.activeElement) || document.activeElement.tagName != 'H2', 'no focus move on the first mount')
      await window.__pwType(`${id} .wz-name`, 'Ada')
      await wait(40)
      await window.__pw('click', `${id} .wz-next`)
      await waitFor(() => document.activeElement?.matches?.('.wz-two h2'))
      assert(!el.querySelector('.wz-one'), 'only the current step is in the DOM')
      assert(document.activeElement.getAttribute('tabindex') === '-1', 'tabindex added')
      assert(document.activeElement.textContent === 'Check Ada', 'the draft: ' + document.activeElement.textContent)
      assert(current().join() === ',step', 'aria-current: ' + current())
      await window.__pw('click', `${id} .wz-back`)
      await waitFor(() => el.querySelector('.wz-name'))
      await waitFor(() => document.activeElement?.matches?.('.wz-one h2'))
      assert(el.querySelector('.wz-name').value === 'Ada', 'Back keeps the value')
    } finally { app.dispose() }
  })

  // Tune: a step disposed while its dialog() / popover() is open (the wizard keeps the step's slice):
  // back on the step, the part is closed, and its trigger opens it again
  function Ask({ state }) {
    return (
      <div className="wz-ask">
        <h2>Ask</h2>
        <button className="wz-open">Open</button>
        <dialog className="wz-dlg" aria-label="Sure?"><p>Sure?</p></dialog>
        <button className="wz-tip-open">Tip</button>
        <div className="wz-tip" popover="manual">tip</div>
        <p className="wz-dlg-state">{state.dlg.open ? 'open' : 'closed'} {state.tip.open ? 'open' : 'closed'}</p>
      </div>
    )
  }
  Ask.uses = {
    dlg: dialog({ dialog: '.wz-dlg', trigger: '.wz-open', modal: false }),
    tip: popover({ popover: '.wz-tip', trigger: '.wz-tip-open' }),
  }
  function AskFlow({ state }) {
    const w = state.wizard
    return (
      <section>
        <Outlet of={{ ask: Ask, two: Two }} from="wizard" />
        <button className="wz-back" disabled={!w.canBack}>Back</button>
        <button className="wz-next" disabled={!w.canNext}>Next</button>
      </section>
    )
  }
  AskFlow.uses = { wizard: wizard({ steps: { ask: {}, two: {} }, draft: { name: '' }, next: '.wz-next', back: '.wz-back' }) }

  await runTest('a step left while its dialog and popover are open comes back with them closed', async () => {
    const { id, el } = mountOnScreen()
    const app = run(AskFlow, {}, { mountPoint: id })
    const $ = (s) => el.querySelector(s)
    const shown = () => $('.wz-tip')?.matches(':popover-open')
    try {
      await waitFor(() => $('.wz-open'))
      for (const how of ['trigger', 'element']) {
        // (the second time: opened without the model, which learns it from the toggle event)
        if (how == 'trigger') { await window.__pw('click', `${id} .wz-open`); await window.__pw('click', `${id} .wz-tip-open`) }
        else { $('.wz-dlg').show(); $('.wz-tip').showPopover() }
        await waitFor(() => $('.wz-dlg').open && shown() && $('.wz-dlg-state').textContent === 'open open')
        await window.__pw('click', `${id} .wz-next`)
        await waitFor(() => $('.wz-two') && !$('.wz-ask'))
        await window.__pw('click', `${id} .wz-back`)
        await waitFor(() => $('.wz-ask'))
        await wait(150)
        assert(!$('.wz-dlg').open, `${how}: the dialog opened on return`)
        assert(!shown(), `${how}: the popover opened on return`)
        assert($('.wz-dlg-state').textContent === 'closed closed', `${how}: ` + $('.wz-dlg-state').textContent)
      }
    } finally { app.dispose() }
  })
}

// Sift stress test bug 3: a blocker that answers a back/forward at once with its `proceed`. The
// router undoes the traversal first; a second history.go() in the same task while that is
// pending is dropped by Chromium, so the proceed waits for the undo to land, and nothing forced is
// left for the next traversal (which is asked about again).
export async function wizardRouterTests() {
  await runTest('a blocked back answered at once lands; the next traversal is still guarded', async () => {
    const start = location.pathname + location.search
    history.pushState(null, '', '/wzr/a')
    const router = makeRouter({ routes: { a: '/a', b: '/b', notFound: '*' }, base: '/wzr', scroll: false, focus: false })
    let asks = 0
    function App({ state }) { return <p className="wzr">{state.route.name}</p> }
    App.route = 'ROUTE'
    App.initialState = { route: router.current() }
    App.model = {
      ROUTE: (s, route) => ({ ...s, route }),
      ASK: { ROUTER: (_s, attempt) => (asks++, { ...attempt.proceed, block: 'ASK' }) },
      BOOTSTRAP: { ROUTER: () => ({ block: 'ASK' }) },
    }
    const { id, el } = mountOnScreen()
    const app = run(App, { ROUTER: router.driver }, { mountPoint: id })
    try {
      await waitFor(() => el.querySelector('.wzr')?.textContent == 'a')
      await wait(30)
      // a link to b: asked (the block), answered at once, made
      const link = document.body.appendChild(document.createElement('a'))
      link.href = '/wzr/b'
      link.click()
      link.remove()
      await waitFor(() => asks == 1 && el.querySelector('.wzr')?.textContent == 'b', 2000)
      asks = 0
      history.back()
      await waitFor(() => asks == 1, 2000)
      await waitFor(() => location.pathname == '/wzr/a' && el.querySelector('.wzr')?.textContent == 'a', 2000)
      asks = 0
      history.forward()
      await waitFor(() => asks == 1, 2000)
      await waitFor(() => location.pathname == '/wzr/b' && el.querySelector('.wzr')?.textContent == 'b', 2000)
    } finally {
      app.dispose()
      await wait(10)
      history.replaceState(null, '', start)
    }
  }, 8000)
}
