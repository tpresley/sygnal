// PLAN-6 G-581 / D253: 'sygnal/ai' re-exports the implementation from 'sygnal', and no subpath
// bundle carries a second copy of the diagnostics module or the reply helpers (a copy replaced
// globalThis.__SYGNAL_DIAGNOSTICS__ and silenced the app's dev checks in spike 0-S1).
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import * as sygnal from '../dist/index.esm.js'
import * as ai from '../dist/ai.esm.js'

const dist = path.resolve(__dirname, '../dist')
const read = f => fs.readFileSync(path.join(dist, f), 'utf8')
// markers of the two modules that must exist once per app
const MARKERS = { diagnostics: '__SYGNAL_DIAGNOSTICS__ = {', replies: "it has a 'then'/'catch' key" }
const MAIN = ['index.esm.js', 'index.cjs.js']

describe('sygnal/ai entry (PLAN-6)', () => {
  it('re-exports from the external sygnal (no code of its own)', () => {
    for (const f of ['ai.esm.js', 'ai.cjs.js']) {
      const src = read(f)
      expect(src).toMatch(/['"]sygnal['"]/)
      // a re-export only: the CJS form spends ~120 B per name on getters
      expect(src.replace(/\/\/# sourceMappingURL.*/, '').length).toBeLessThan(300 + 150 * Object.keys(ai).length)
    }
    for (const name of Object.keys(ai)) expect(ai[name]).toBe(sygnal[name])
  })

  it('no subpath bundle carries a copy of the diagnostics module or the reply helpers (G-581)', () => {
    const bundles = fs.readdirSync(dist).filter(f => /\.(esm|cjs)\.js$/.test(f) && !MAIN.includes(f))
    expect(bundles.length).toBeGreaterThan(10)
    for (const f of bundles) {
      const src = read(f)
      for (const [name, marker] of Object.entries(MARKERS)) {
        expect(src.includes(marker), `${f} contains a copy of ${name}`).toBe(false)
      }
    }
    for (const f of MAIN) for (const marker of Object.values(MARKERS)) expect(read(f)).toContain(marker)
  })

  it('messageText joins text parts or returns content', () => {
    expect(ai.messageText({ role: 'assistant', parts: [{ type: 'reasoning', text: 'x' }, { type: 'text', text: 'Hi' }, { type: 'text', text: ' there' }] })).toBe('Hi there')
    expect(ai.messageText({ role: 'user', content: 'yo' })).toBe('yo')
    expect(ai.messageText(null)).toBe('')
  })

  // PLAN-6 4-F: the raw driver's tool loop writes the outputs into the message's tool parts
  it('withToolResults answers the open tool parts by call id, tool name or a function', () => {
    const m = { role: 'assistant', parts: [
      { type: 'text', text: 'On it.' },
      { type: 'tool-add', toolCallId: 'c1', state: 'input-available', input: { name: 'milk' } },
      { type: 'tool-add', toolCallId: 'c2', state: 'input-available', input: { name: 'eggs' } },
      { type: 'tool-find', toolCallId: 'c3', state: 'input-available', input: {} },
      { type: 'tool-add', toolCallId: 'c0', state: 'output-available', input: {}, output: 'old' },
    ] }
    const byKey = ai.withToolResults(m, { c1: { ok: 1 }, add: { ok: 2 } })
    expect(byKey.parts.map((p) => p.state)).toEqual([undefined, 'output-available', 'output-available', 'input-available', 'output-available'])
    expect(byKey.parts.map((p) => p.output)).toEqual([undefined, { ok: 1 }, { ok: 2 }, undefined, 'old'])
    expect(m.parts[1].state).toBe('input-available')
    const byFn = ai.withToolResults(m, (call) => {
      if (call.name === 'find') throw new Error('not found')
      return call.input.name === 'eggs' ? new Error('no eggs') : [call.id, call.input.name]
    })
    expect(byFn.parts.slice(1, 4)).toEqual([
      { type: 'tool-add', toolCallId: 'c1', state: 'output-available', input: { name: 'milk' }, output: ['c1', 'milk'] },
      { type: 'tool-add', toolCallId: 'c2', state: 'output-error', input: { name: 'eggs' }, errorText: 'no eggs' },
      { type: 'tool-find', toolCallId: 'c3', state: 'output-error', input: {}, errorText: 'not found' },
    ])
    expect(ai.withToolResults(m, {})).toBe(m)
    expect(ai.withToolResults(null, {})).toBe(null)
  })
})
