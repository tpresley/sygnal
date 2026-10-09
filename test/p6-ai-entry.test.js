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
      expect(src.replace(/\/\/# sourceMappingURL.*/, '').length).toBeLessThan(2000)
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
})
