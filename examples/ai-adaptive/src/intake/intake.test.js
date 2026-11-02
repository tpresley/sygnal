// The intake form, with a scripted model (composeWith answers with compose.llm()'s own replies).
import { describe, it, expect, afterEach } from 'vitest'
import { renderComponent } from 'sygnal'
import { composeWith } from 'sygnal/ai'
import IntakeLab from './IntakeLab.jsx'
import { catalog, missingNames, placed, requiredNames } from './catalog.jsx'

let t
afterEach(() => { t?.dispose(); t = null })

const LAPTOP = [
  { part: 'section', params: { title: 'What happened' }, children: [
    { part: 'device' },
    { part: 'dates', params: { label: 'When did you lose it?' } },
    { part: 'place', params: { label: 'Where did you last have it?' } },
  ] },
  { part: 'urgency' },
  { part: 'contact', params: { phone: 'required' } },
  { part: 'question', params: { label: 'Was the laptop encrypted?', answer: 'yesno' } },
]

async function build(task = 'I left my work laptop on the train', tree = LAPTOP) {
  t = renderComponent(IntakeLab, { strict: true })
  await t.ready()
  t.simulateEvent('.task', 'input', { value: task })
  t.simulateEvent('.ask', 'submit')
  await t.next((s) => s.page.status === 'composing')
  await composeWith(t, catalog, tree)
  await t.waitForState((s) => s.page.status === 'done')
}

const type = (name, value) => t.simulateEvent(`[name="${name}"]`, 'input', { value })

describe('building the form', () => {
  it('frames the task as a request for the fields it needs', async () => {
    await build()
    const request = t.requests('LLM').at(-1)
    expect(request.messages.at(-1).content).toContain('A form to file this request: "I left my work laptop on the train"')
  })

  it('renders the pieces the model picked, with the labels it wrote, inside one form', async () => {
    await build()
    const html = t.html()
    expect(html).toContain('<legend>What happened</legend>')
    expect(html).toContain('When did you lose it?')
    expect(html).toContain('Was the laptop encrypted?')
    expect(html).toContain('name="assetTag"')
    expect(html).toContain('name="extra.question"')
    expect(placed(t.state.page.layout).map((p) => p.key)).toEqual(['device', 'dates', 'place', 'urgency', 'contact', 'question'])
  })

  it('keeps every value in the one form slice, model-written questions under extra.<node key>', async () => {
    await build()
    type('assetTag', 'AT-10442')
    type('extra.question', 'yes')
    await t.settle()
    expect(t.state.intake.values.assetTag).toBe('AT-10442')
    expect(t.state.intake.values.extra).toEqual({ question: 'yes', 'question~2': '', 'question~3': '' })
  })
})

describe('what the form requires', () => {
  it('follows the composed form, not a fixed schema', async () => {
    await build()
    expect(requiredNames(t.state.page.layout)).toEqual(['device', 'assetTag', 'start', 'place', 'urgency', 'email', 'phone', 'extra.question'])
    expect(missingNames(t.state.page.layout, { ...t.state.intake.values, device: 'laptop' })).not.toContain('device')
  })

  it('marks the empty fields on submit and sends once they are filled', async () => {
    await build('Request a second monitor', [{ part: 'device' }, { part: 'approver' }])
    t.simulateEvent('.intake', 'submit')
    await t.next((s) => s.missing.length > 0)
    expect(t.state.missing).toEqual(['device', 'assetTag', 'approver'])
    expect(t.html()).toContain('Fill in the 3 highlighted fields.')

    t.simulateEvent('[name="device"]', 'input', { value: 'monitor' })
    type('assetTag', 'AT-20001')
    t.simulateEvent('[name="approver"]', 'input', { value: 'kim' })
    await t.next((s) => s.missing.length === 0)
    t.simulateEvent('.intake', 'submit')
    await t.waitForState((s) => s.sent)
    expect(t.state.sent.values).toMatchObject({ device: 'monitor', assetTag: 'AT-20001', approver: 'kim' })
    expect(Object.keys(t.state.sent.fields)).toEqual(['device', 'approver'])
  })

  it('still runs the schema checks of the pieces that are there', async () => {
    await build('Request a second monitor', [{ part: 'device' }])
    type('assetTag', 'sticker 12')
    t.simulateEvent('[name="assetTag"]', 'focusout')
    await t.settle()
    expect(t.html()).toContain('Asset tags look like AT-10442')
  })
})

describe('editing the form', () => {
  it('a follow-up in words keeps what was typed', async () => {
    await build()
    type('place', 'Platform 4, Central')
    await t.settle()
    t.simulateEvent('.change-prompt', 'input', { value: 'Drop the dates' })
    t.simulateEvent('.change', 'submit')
    await t.next((s) => s.page.status === 'composing')
    expect(t.requests('LLM').at(-1).messages.at(-1).content).toMatch(/^Current page:/)
    const tree = structuredClone(LAPTOP)
    tree[0].children.splice(1, 1)
    await composeWith(t, catalog, tree)
    await t.waitForState((s) => s.page.status === 'done' && !s.page.layout.nodes.dates)
    expect(t.state.intake.values.place).toBe('Platform 4, Central')
    expect(t.html()).toContain('value="Platform 4, Central"')
  })

  it('removes a piece without a model call', async () => {
    await build()
    const calls = t.requests('LLM').length
    t.simulateEvent('.remove-piece[data-key="question"]', 'click')
    await t.waitForState((s) => !s.page.layout.nodes.question)
    expect(t.requests('LLM').length).toBe(calls)
  })
})

describe('the form grows while it is filled in', () => {
  it('a critical request asks the model to add the approver, once', async () => {
    await build()
    t.simulateEvent('[name="urgency"][value="critical"]', 'input', { checked: true, value: 'critical' })
    await t.waitForState((s) => s.adapted.includes('approval'))
    await t.next((s) => s.page.status === 'composing')
    expect(t.requests('LLM').at(-1).messages.at(-1).content).toContain('Change: Add the approver field right below the urgency')

    const tree = structuredClone(LAPTOP)
    tree.splice(2, 0, { part: 'approver' })
    await composeWith(t, catalog, tree)
    await t.waitForState((s) => s.page.status === 'done' && !!s.page.layout.nodes.approver)
    expect(t.state.intake.values.urgency).toBe('critical')
    expect(t.html()).toContain('Critical requests need a manager to sign off')

    // the rule fired once: choosing critical again doesn't ask again
    const calls = t.requests('LLM').length
    t.simulateEvent('[name="urgency"][value="low"]', 'input', { checked: true, value: 'low' })
    t.simulateEvent('[name="urgency"][value="critical"]', 'input', { checked: true, value: 'critical' })
    await t.settle()
    expect(t.requests('LLM').length).toBe(calls)
  })
})
