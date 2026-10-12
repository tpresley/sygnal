import { describe, it, expect, afterEach } from 'vitest'
import { renderComponent } from 'sygnal'
import { Host } from './Host.jsx'
import { catalog } from './catalog.js'
import { createSpecStreamCompiler } from '../vendor/json-render-core.mjs'

const SPEC = {
  root: 'page',
  state: { feedback: { message: '' }, tasks: [{ id: 1, text: 'Write', done: false }, { id: 2, text: 'Test', done: true }], plan: 'free' },
  elements: {
    page: { type: 'Stack', props: { direction: null }, children: ['title', 'form', 'tasks', 'pro'] },
    title: { type: 'Heading', props: { text: 'Hello' }, children: [] },
    form: { type: 'Card', props: { title: 'Feedback' }, children: ['msg', 'echo', 'send'] },
    msg: { type: 'TextInput', props: { label: 'Message', value: { $bindState: '/feedback/message' } }, children: [] },
    echo: { type: 'Text', props: { text: { $state: '/feedback/message' } }, children: [] },
    send: {
      type: 'Button', props: { label: 'Send' }, children: [],
      on: { press: [
        { action: 'submitFeedback', params: { message: { $state: '/feedback/message' } } },
        { action: 'setState', params: { statePath: '/feedback/message', value: '' } },
      ] },
    },
    tasks: { type: 'Stack', props: { direction: null }, repeat: { statePath: '/tasks', key: 'id' }, children: ['task'] },
    task: { type: 'Checkbox', props: { label: { $item: 'text' }, checked: { $bindItem: 'done' } }, children: [] },
    pro: { type: 'Text', props: { text: 'Pro features' }, visible: { $state: '/plan', eq: 'pro' }, children: [] },
  },
}

let t
afterEach(() => t?.dispose())
const start = (spec = SPEC) => {
  t = renderComponent(Host, { strict: true, initialState: { spec, ui: structuredClone(spec.state || {}), outbox: [] } })
  return t.ready()
}

describe('json-render Spec on Sygnal', () => {
  it('the spec is valid for the catalog', () => {
    expect(catalog.validate(SPEC).success).toBe(true)
  })

  it('renders elements, $state props, repeat with $item, and visibility', async () => {
    await start()
    const html = t.html()
    expect(html).toContain('<h2 class="heading">Hello</h2>')
    expect(t.queryAll('.check').map((e) => e.textContent.trim())).toEqual(['Write', 'Test'])
    expect(t.queryAll('.box').map((e) => e.checked)).toEqual([false, true])
    expect(html).not.toContain('Pro features')
  })

  it('$bindState: typing writes the host state tree; $state readers follow', async () => {
    await start()
    t.simulateEvent('.input-msg', 'input', { value: 'Nice app' })
    await t.next((s) => s.ui.feedback.message === 'Nice app')
    expect(t.query('.text').textContent).toBe('Nice app')
  })

  it('events → actions: setState is a reducer, app actions go to the host with resolved params', async () => {
    await start()
    t.simulateEvent('.input-msg', 'input', { value: 'Ship it' })
    await t.next((s) => s.ui.feedback.message === 'Ship it')
    t.simulateEvent('.btn-send', 'click')
    await t.next((s) => s.outbox.length === 1)
    await t.settle()
    expect(t.state.outbox).toEqual(['Ship it'])        // params resolved before setState cleared it
    expect(t.state.ui.feedback.message).toBe('')
  })

  it('a component part ($bindItem inside repeat) writes its item back through a lens', async () => {
    await start()
    t.simulateEvent('.box', 'change', { checked: true })
    await t.next((s) => s.ui.tasks[0].done === true)
    expect(t.state.ui.tasks[1].done).toBe(true)
  })

  it('visibility follows state', async () => {
    await start({ ...SPEC, state: { ...SPEC.state, plan: 'pro' } })
    expect(t.html()).toContain('Pro features')
  })

  it('streams JSONL patches (the LLM path) into the rendered tree', async () => {
    await start({ root: '', elements: {} })
    const compiler = createSpecStreamCompiler()
    const lines = [
      { op: 'add', path: '/root', value: 'page' },
      { op: 'add', path: '/elements/page', value: { type: 'Stack', props: { direction: null }, children: ['h', 'm'] } },
      { op: 'add', path: '/elements/h', value: { type: 'Heading', props: { text: 'Sales' }, children: [] } },
      { op: 'add', path: '/elements/m', value: { type: 'Metric', props: { label: 'Revenue', value: '$48.2k' }, children: [] } },
    ].map((p) => JSON.stringify(p) + '\n')
    // chunk boundaries mid-line, like a token stream
    const text = lines.join('')
    const seen = []
    for (let i = 0; i < text.length; i += 37) {
      const { result, newPatches } = compiler.push(text.slice(i, i + 37))
      if (!newPatches.length) continue
      t.simulateAction('SPEC_PATCHED', structuredClone(result))
      await t.settle()
      seen.push(t.queryAll('.heading').length + t.queryAll('.metric').length)
    }
    expect(seen.at(-1)).toBe(2)
    expect(t.html()).toContain('$48.2k')
  })
})

describe('diagnostics', () => {
  it('a full interaction leaves no Sygnal diagnostics', async () => {
    await start()
    t.simulateEvent('.input-msg', 'input', { value: 'x' })
    t.simulateEvent('.btn-send', 'click')
    t.simulateEvent('.box', 'change', { checked: true })
    await t.settle()
    console.log(JSON.stringify(t.actions.map((a) => [a.component, a.type, a.sinks])))
    t.expectNoDiagnostics()
  })
})
