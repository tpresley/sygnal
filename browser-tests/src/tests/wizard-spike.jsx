// The wizard spike (dev-plans/research/wizard), BROWSER=chromium|firefox|webkit: with real clicks
// and keys, Next moves to a step whose heading gets focus (tabindex=-1 added, not on the first
// mount), the stepper's aria-current follows, Back keeps the step's typed value, and only the
// current step is in the DOM.
import { run, wizard, Outlet } from 'sygnal'
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
}
