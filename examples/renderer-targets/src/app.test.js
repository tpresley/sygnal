// One app, three targets, one set of behaviours: renderComponent tests the logic with no renderer;
// the terminal and the agent UI run the same component tree.
import { describe, it, expect, afterEach } from 'vitest'
import { run, renderComponent } from 'sygnal'
import { createTerminal } from 'sygnal/terminal'
import { runAgentUI } from 'sygnal/agent-ui'
import Groceries, { Name, AddForm, ClearDone } from './app.jsx'
import { terminalStyles } from './styles.js'

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms))
const apps = []
afterEach(() => apps.splice(0).forEach((a) => a.dispose()))

describe('the logic (renderComponent)', () => {
  it('adds an item from the form and clears the draft', async () => {
    const t = renderComponent(Groceries)
    await t.ready()
    await t.simulateEvent(Name, 'input', { target: { value: 'Bread' } })
    await t.simulateAction('ADD', { name: 'Bread', category: 'bakery' })
    await t.waitForState((s) => s.items.length === 3 && s.draft === '')
    expect(t.state.items[2]).toEqual({ id: 3, name: 'Bread', category: 'bakery', done: false })
    t.dispose()
  })

  it('an empty name adds nothing', async () => {
    const t = renderComponent(Groceries)
    await t.ready()
    await t.simulateAction('ADD', { name: '  ', category: 'other' })
    expect(t.state.items).toHaveLength(2)
    t.dispose()
  })
})

describe('in a terminal', () => {
  it('renders, adds with the keyboard, checks an item off, clears the cart', async () => {
    const term = createTerminal({ styles: terminalStyles })
    apps.push(run(Groceries, { DOM: term.driver }))
    await tick()
    expect(term.frame()).toBe([
      'GROCERIES',
      'Item [Milk, bread, …] Aisle [produce ▾] [Add]',
      '  • [ ] Apples (produce) [×]',
      '  • [x] Milk ✓ (dairy) [×]',
      '— 1 to buy · Show [all ▾] [Clear the cart]',
    ].join('\n'))
    term.focus(String(Name))
    term.type('Eggs')
    term.press('Tab')
    term.press('ArrowRight') // produce → dairy
    term.press('Tab')
    term.press('Enter')      // Add
    await tick()
    expect(term.frame()).toContain('• [ ] Eggs (dairy) [×]')
    term.focus('.item:not(.done) input')
    term.press(' ')
    await tick()
    expect(term.frame()).toContain('— 1 to buy ·')
    term.focus(String(ClearDone))
    term.press('Enter')
    await tick()
    expect(term.frame()).not.toMatch(/Milk ✓|Apples/)
  })
})

describe('for an agent', () => {
  it('the snapshot, and tool calls that type, choose, submit and check', async () => {
    const { app, ui } = runAgentUI(Groceries)
    apps.push(app)
    await ui.settle()
    const ref = (s, text) => new RegExp(`${text}.*?\\[ref=(e\\d+)\\]`).exec(s)[1]
    let s = ui.snapshot()
    expect(s.replace(/e\d+/g, 'e')).toBe([
      '- main:',
      '  - heading "Groceries" [level=1]',
      '  - textbox "Item" [ref=e]',
      '  - combobox "Aisle" [ref=e]: "produce":',
      '    - option "produce" [selected]',
      '    - option "dairy"',
      '    - option "bakery"',
      '    - option "other"',
      '  - button "Add" [ref=e]',
      '  - list:',
      '    - listitem:',
      '      - checkbox "Apples" [ref=e]',
      '      - text: produce',
      '      - button "Remove Apples" [ref=e]',
      '    - listitem:',
      '      - checkbox "Milk" [checked] [ref=e]',
      '      - text: dairy',
      '      - button "Remove Milk" [ref=e]',
      '  - text: 1 to buy',
      '  - combobox "Show" [ref=e]: "all":',
      '    - option "all" [selected]',
      '    - option "to buy"',
      '    - option "in the cart"',
      '  - button "Clear the cart" [ref=e]',
    ].join('\n'))
    await ui.call('ui_type', { ref: ref(s, 'textbox "Item"'), text: 'Croissants' })
    await ui.call('ui_select', { ref: ref(s, 'combobox "Aisle"'), option: 'bakery' })
    s = (await ui.call('ui_click', { ref: ref(s, 'button "Add"') })).snapshot
    expect(s).toContain('checkbox "Croissants"')
    expect(app.__runtime.getState().items[2]).toEqual({ id: 3, name: 'Croissants', category: 'bakery', done: false })
    s = (await ui.call('ui_check', { ref: ref(s, 'checkbox "Croissants"'), checked: true })).snapshot
    expect(s).toContain('checkbox "Croissants" [checked]')
    s = (await ui.call('ui_select', { ref: ref(s, 'combobox "Show"'), option: 'to buy' })).snapshot
    expect(s).not.toContain('Croissants')
    expect(s).toContain('checkbox "Apples"')
  })
})
