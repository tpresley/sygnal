// The intake form, with a scripted model (composeWith answers with compose.llm()'s own replies).
import { describe, it, expect, afterEach } from 'vitest'
import { renderComponent } from 'sygnal'
import { composeWith } from 'sygnal/ai'
import IntakeLab from './IntakeLab.jsx'
import { catalog, placed } from './catalog.jsx'

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
    expect(html).toContain('name="device.assetTag"')
    expect(html).toContain('name="question"')
    expect(placed(t.state.page.layout).map((p) => p.key)).toEqual(['device', 'dates', 'place', 'urgency', 'contact', 'question'])
  })

  it('keeps every value in the one form slice, each piece\'s under its node key, and only the pieces placed', async () => {
    await build()
    type('device.assetTag', 'AT-10442')
    type('question', 'yes')
    await t.settle()
    expect(t.state.intake.values).toEqual({
      device: { kind: '', assetTag: 'AT-10442' },
      dates: { start: '' },
      place: '',
      urgency: '',
      contact: { email: '', phone: '' },
      question: 'yes',
    })
  })

  it('a piece can repeat: two amounts, each with its own values', async () => {
    await build('Expense the flight and the hotel', [
      { part: 'amount', params: { label: 'Flight' } },
      { part: 'amount', params: { label: 'Hotel' } },
    ])
    expect(placed(t.state.page.layout).map((p) => p.key)).toEqual(['amount', 'amount~2'])
    type('amount.amount', '320')
    type('amount~2.amount', '180')
    t.simulateEvent('[name="amount~2.currency"]', 'input', { value: 'EUR' })
    await t.settle()
    t.simulateEvent('.intake', 'submit')
    await t.waitForState((s) => s.sent)
    expect(t.state.sent.values).toEqual({ amount: { amount: 320, currency: 'USD' }, 'amount~2': { amount: 180, currency: 'EUR' } })
  })
})

describe('what the form requires', () => {
  it('follows the composed form: every field on it, by the piece\'s params (the contact\'s phone is required here)', async () => {
    await build()
    expect(Object.keys(t.state.intake.errors)).toEqual(['device.kind', 'device.assetTag', 'dates.start', 'place', 'urgency', 'contact.email', 'contact.phone', 'question'])
    expect(t.state.intake.valid).toBe(false)
  })

  it('marks the empty fields on submit and sends once they are filled', async () => {
    await build('Request a second monitor', [{ part: 'device' }, { part: 'approver' }])
    t.simulateEvent('.intake', 'submit')
    await t.next((s) => s.intake.submitCount === 1)
    expect(t.state.sent).toBe(null)
    expect(t.state.intake.submitted).toBe(false)
    expect(t.state.intake.fields['device.kind'].error).toBe('Required')
    expect(t.html()).toContain('Fill in the 3 highlighted fields.')

    t.simulateEvent('[name="device.kind"]', 'input', { value: 'monitor' })
    type('device.assetTag', 'AT-20001')
    t.simulateEvent('[name="approver"]', 'input', { value: 'kim' })
    await t.settle()
    expect(t.html()).not.toContain('highlighted field')
    t.simulateEvent('.intake', 'submit')
    await t.waitForState((s) => s.sent)
    expect(t.state.sent.values).toEqual({ device: { kind: 'monitor', assetTag: 'AT-20001' }, approver: 'kim' })
    expect(Object.keys(t.state.sent.fields)).toEqual(['device', 'approver'])
  })

  it('a piece removed is no longer required, and its value is not sent', async () => {
    await build('Request a second monitor', [{ part: 'device' }, { part: 'approver' }])
    t.simulateEvent('[name="approver"]', 'input', { value: 'kim' })
    t.simulateEvent('.intake', 'submit')
    await t.next((s) => s.intake.submitCount === 1)
    t.simulateEvent('.remove-piece[data-key="device"]', 'click')
    await t.waitForState((s) => !s.page.layout.nodes.device)
    expect(t.state.intake.errors).toEqual({})
    t.simulateEvent('.intake', 'submit')
    await t.waitForState((s) => s.sent)
    expect(t.state.sent.values).toEqual({ approver: 'kim' })
  })

  it('still runs the schema checks of the pieces that are there', async () => {
    await build('Request a second monitor', [{ part: 'device' }])
    type('device.assetTag', 'sticker 12')
    t.simulateEvent('[name="device.assetTag"]', 'focusout')
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
    expect('question' in t.state.intake.values).toBe(false)
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
