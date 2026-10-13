import { it, expect, afterEach } from 'vitest'
import { renderComponent } from 'sygnal'
import { answers } from 'sygnal/ai'
import CommandBar from './CommandBar.jsx'
import { PROVIDERS } from '../../shared/fixtures.js'

let t
afterEach(() => t?.dispose())

const start = async () => {
  t = renderComponent(CommandBar)
  await t.respond('HTTP', PROVIDERS, 'providers')
  return t
}

/** type a command and run it; the decision request is then pending */
const command = async (text) => {
  t.simulateEvent('.command', 'input', { value: text })
  t.simulateEvent('.command-form', 'submit')
  await t.settle()
  return t.requests('HTTP').at(-1)
}

/** answer the pending decision with these picks, and wait until the command bar has handled it */
const decideWith = async (picks) => {
  const req = t.requests('HTTP').at(-1)
  await t.respond('HTTP', answers(req.json.questions, picks), 'cmd.DECIDED')
  await settled()
}

/** the command ran, was refused, or waits for a confirmation (a call runs in a later tick) */
async function settled() {
  for (let i = 0; i < 20 && t.state.cmd.status !== 'ready' && !t.state.cmd.pending; i++) await t.settle()
}

it('asks the picked decision model which action and which card, and runs a sure answer', async () => {
  await start()
  const req = await command('move "write docs" to done')
  expect(req).toMatchObject({ url: 'http://localhost:11434/v1/systemone', json: { model: 'nimble:latest' } })
  expect(Object.keys(req.json.questions.action.criteria)).toEqual(expect.arrayContaining(['board_add', 'board_clear_done', 'card_move=done', 'card_star', 'card_remove', 'none']))
  expect(req.json.questions.target.criteria).toMatchObject({ 1: 'Write docs', none: 'No existing card' })
  await decideWith({ action: { choice: 'card_move=done', confidence: 0.93 }, target: { choice: '1', confidence: 0.97 } })
  expect(t.state.cards[0].column).toBe('done')
  expect(t.state.log[0]).toMatchObject({ command: 'move "write docs" to done', outcome: 'ran' })
  expect(t.html()).toContain('Ran')
})

it('adds a card from the free text of the command', async () => {
  await start()
  await command('add a card to call the bank')
  await decideWith({ action: { choice: 'board_add', confidence: 0.9 }, target: 'none' })
  expect(t.state.cards.at(-1)).toMatchObject({ id: 6, title: 'call the bank', column: 'todo' })
})

it('asks before a consequential action: Cancel keeps the card, Delete removes it', async () => {
  await start()
  await command('delete the card about the logo')
  await decideWith({ action: { choice: 'card_remove', confidence: 0.91 }, target: { choice: '2', confidence: 0.95 } })
  expect(t.html()).toContain('Delete the card: "Design the logo"?')
  t.simulateEvent('.cmd-deny', 'click')
  await settled()
  expect(t.state.cards.some((c) => c.id === 2)).toBe(true)
  expect(t.state.log[0].outcome).toBe('declined')

  await command('delete the card about the logo')
  await decideWith({ action: { choice: 'card_remove', confidence: 0.91 }, target: { choice: '2', confidence: 0.95 } })
  t.simulateEvent('.cmd-approve', 'click')
  await settled()
  expect(t.state.cards.some((c) => c.id === 2)).toBe(false)
})

it('runs nothing when the model is unsure', async () => {
  await start()
  await command("what's left?")
  await decideWith({ action: { choice: 'card_move=done', confidence: 0.38 }, target: 'none' })
  expect(t.state.cmd.unsure).toMatchObject({ reason: 'confidence' })
  expect(t.state.cards).toEqual(CommandBar.initialState.cards)
  expect(t.state.log[0].outcome).toBe('unsure')
  expect(t.html()).toContain('Nothing ran')
})

it('sends the commands to Jev when Jev is picked, and keeps the board', async () => {
  await start()
  await command('star the launch party')
  await decideWith({ action: { choice: 'card_star', confidence: 0.9 }, target: { choice: '3', confidence: 0.9 } })
  t.simulateEvent('.model-pick', 'change', { value: 'typesafe::jev-latest' })
  await t.settle()
  expect(t.state.cards[2].starred).toBe(true)
  const req = await command('move "write docs" to done')
  expect(req).toMatchObject({ url: '/api/decide', json: { model: 'jev-latest' } })
})
