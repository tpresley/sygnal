// Renders the specs scripts/compose.mjs produced (decision models) and scripts/llm.mjs produced (chat LLM)
// with the Sygnal renderer, and drives the feedback form when present.
import { describe, it, expect, afterEach } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { renderComponent } from 'sygnal'
import { Host } from './Host.jsx'
import { catalog } from './catalog.js'
import { autoFixSpec } from '../vendor/json-render-core.mjs'

const dir = new URL('../out/', import.meta.url)
const files = readdirSync(dir).filter((f) => f.endsWith('.json'))
let t
afterEach(() => t?.dispose())

describe.each(files)('%s', (file) => {
  it('validates against the catalog and renders in Sygnal', async () => {
    let { spec } = JSON.parse(readFileSync(new URL(file, dir), 'utf8'))
    expect(spec).toBeTruthy()
    // decision-model output is valid by construction; small-LLM output is repaired first (json-render's autoFixSpec)
    if (file.startsWith('compose-')) expect(catalog.validate(spec).success).toBe(true)
    else spec = autoFixSpec(spec).spec
    t = renderComponent(Host, { strict: true, initialState: { spec, ui: structuredClone(spec.state || {}), outbox: [] } })
    await t.ready()
    const types = new Set(Object.values(spec.elements).map((e) => e.type))
    if (types.has('Metric')) expect(t.queryAll('.metric').length).toBeGreaterThan(0)
    const send = Object.entries(spec.elements).find(([, e]) => e.type === 'Button' && e.on?.press)
    const field = Object.entries(spec.elements).find(([, e]) => e.type === 'TextInput' && e.props.value?.$bindState)
    if (send && field) {
      t.simulateEvent(`.input-${field[0]}`, 'input', { value: 'Hello from a composed UI' })
      await t.next((s) => getMsg(s, field[1]) === 'Hello from a composed UI')
      t.simulateEvent(`.btn-${send[0]}`, 'click')
      await t.settle()
      const submit = [send[1].on.press].flat().find((b) => b.action === 'submitFeedback')
      // a model that bound the message param gets the typed text; one that left params out sends nothing useful
      // (catalog.validate() does not check `on` bindings: llama3.1 got away with { action: 'submitFeedback' })
      if (submit?.params?.message) expect(t.state.outbox).toEqual(['Hello from a composed UI'])
    }
    if (file.startsWith('compose-')) t.expectNoDiagnostics()
  })
})
const getMsg = (s, el) => el.props.value.$bindState.split('/').filter(Boolean).reduce((o, k) => o?.[k], s.ui)
