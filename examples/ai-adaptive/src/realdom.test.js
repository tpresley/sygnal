// @vitest-environment jsdom
// What only a real DOM shows: elements kept (and so focus and typing) while a model edits or
// re-arranges the page, and form submits heard on forms that appear later.
import { it, expect, afterEach } from 'vitest'
import { renderComponent } from 'sygnal'
import { composeWith } from 'sygnal/ai'
import IntakeLab from './intake/IntakeLab.jsx'
import { catalog as intakeCatalog } from './intake/catalog.jsx'
import BoardLab from './board/BoardLab.jsx'
import { catalog as boardCatalog } from './board/catalog.js'
import { START, step } from './board/world.js'

let t
afterEach(() => { t?.dispose(); t = null })

const FORM = [{ part: 'place' }, { part: 'details' }, { part: 'contact' }]

async function intake() {
  t = renderComponent(IntakeLab, { dom: 'real' })
  await t.ready()
  t.simulateAction('PICK_TASK', 'I left my work laptop on the train')
  await t.next((s) => s.page.status === 'composing')
  await composeWith(t, intakeCatalog, FORM)
  await t.waitForState((s) => s.page.status === 'done')
}

it('a piece inserted above the field being typed in keeps that field’s element', async () => {
  await intake()
  const details = t.query('[name="details"]')
  details.focus()
  // typing "laptop" makes the app ask for the device piece above the details
  t.simulateEvent('[name="details"]', 'input', { value: 'Grey laptop bag' })
  await t.next((s) => s.page.status === 'composing')
  await composeWith(t, intakeCatalog, [{ part: 'place' }, { part: 'device' }, { part: 'details' }, { part: 'contact' }])
  await t.waitForState((s) => s.page.status === 'done' && !!s.page.layout.nodes.device)
  expect(t.query('[name="details"]')).toBe(details)
  expect(document.activeElement).toBe(details)
})

it('the change form, which appears with the first form, has its submit prevented and heard', async () => {
  await intake()
  t.simulateEvent('.change-prompt', 'input', { value: 'Drop the place' })
  await t.settle()
  const submit = new Event('submit', { bubbles: true, cancelable: true })
  t.query('.change').dispatchEvent(submit)
  expect(submit.defaultPrevented).toBe(true)
  await t.next((s) => s.page.status === 'composing')
  expect(t.requests('LLM').at(-1).messages.at(-1).content).toContain('Change: Drop the place')
})

it('cards stay mounted while the model streams the next arrangement', async () => {
  let world = { ...START }
  while (world.tick < 6) world = step(world)
  t = renderComponent(BoardLab, { dom: 'real', initialState: { ...BoardLab.initialState, ...world } })
  await t.ready()
  await t.waitForState((s) => s.page.layout?.nodes['incident:41'])
  const note = t.query('[data-node="incident:41"] .note-text')

  t.simulateEvent('.arrange', 'change', { value: 'model' })
  await t.next((s) => s.page.status === 'composing')
  const seen = []
  const watch = setInterval(() => seen.push(!!t.query('[data-node="incident:41"] .note-text')), 0)
  // the model writes incident 41 last: before that, it stays where it was
  await composeWith(t, boardCatalog, [
    { part: 'incident', params: { id: 42, size: 'full' } },
    { part: 'slo', params: { size: 'compact' } },
    { part: 'queue', params: { size: 'compact' } },
    { part: 'incident', params: { id: 41, size: 'full' } },
  ], { stream: 6 })
  await t.waitForState((s) => s.page.status === 'done')
  clearInterval(watch)
  expect(seen.length).toBeGreaterThan(0)
  expect(seen.every(Boolean)).toBe(true)
  expect(t.query('[data-node="incident:41"] .note-text')).toBe(note)
})
