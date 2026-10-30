// One component file, tested once for its logic and once per text target. The native run is in
// the iOS simulator (README); the bridge itself is tested in the library (test/renderers-react-native).
import { describe, it, expect, afterEach } from 'vitest'
import { run, renderComponent } from 'sygnal'
import { createTerminal } from 'sygnal/terminal'
import { runAgentUI } from 'sygnal/agent-ui'
import Tasks, { Draft, Add } from './Tasks.jsx'

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms))
const apps = []
afterEach(() => apps.splice(0).forEach((a) => a.dispose()))

describe('the logic (renderComponent: no renderer)', () => {
  it('adds a task, ignores an empty one', async () => {
    const t = renderComponent(Tasks)
    await t.ready()
    await t.simulateEvent(Draft, 'input', { target: { value: '  ' } })
    await t.simulateEvent(Add, 'click')
    await t.simulateEvent(Draft, 'input', { target: { value: 'Ship it' } })
    await t.simulateEvent(Draft, 'keydown', { key: 'Enter' })
    await t.waitForState((s) => s.tasks.length === 3 && s.draft === '')
    expect(t.state.tasks[2]).toEqual({ id: 3, title: 'Ship it', done: false })
    t.dispose()
  })
})

describe('in a terminal', () => {
  it('renders the primitives as text and takes keys', async () => {
    const term = createTerminal()
    apps.push(run(Tasks, { DOM: term.driver }))
    await tick()
    expect(term.frame()).toBe([
      'Tasks',
      '1 open · 1 done',
      '[What needs doing?] [Add]',
      '[x] Write the component once [✕]',
      '[ ] Run it on iOS [✕]',
      '[Clear done]',
    ].join('\n'))
    term.focus(Draft)
    term.type('Ship it')
    term.press('Enter')
    await tick()
    expect(term.frame()).toContain('[ ] Ship it [✕]')
    expect(term.frame()).toContain('2 open · 1 done')
  })
})

describe('for an agent', () => {
  it('the snapshot names each control, and tool calls drive the same intents', async () => {
    const { app, ui } = runAgentUI(Tasks)
    apps.push(app)
    await ui.settle()
    const snap = ui.snapshot()
    expect(snap.replace(/e\d+/g, 'e')).toBe([
      '- text: Tasks',
      '- text: 1 open · 1 done',
      '- textbox "New task" [ref=e]',
      '- button "Add" [ref=e]',
      '- list:',
      '  - switch "Done: Write the component once" [checked] [ref=e]',
      '  - text: Write the component once',
      '  - button "Remove Write the component once" [ref=e]',
      '  - switch "Done: Run it on iOS" [ref=e]',
      '  - text: Run it on iOS',
      '  - button "Remove Run it on iOS" [ref=e]',
      '- button "Clear done" [ref=e]',
    ].join('\n'))
    const ref = (s, text) => new RegExp(`${text}.*?\\[ref=(e\\d+)\\]`).exec(s)[1]
    await ui.call('ui_check', { ref: ref(snap, 'switch "Done: Run it on iOS"'), checked: true })
    const r = await ui.call('ui_click', { ref: ref(snap, 'button "Clear done"') })
    expect(r.snapshot).not.toContain('Run it on iOS')
    expect(r.snapshot).toContain('0 open · 0 done')
  })
})
