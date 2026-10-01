// Strict mode (2A) through the BUILT packages: the strict checks ship in
// 'sygnal/diagnostics' only (D29: nothing in the main bundle), and
// renderComponent({ strict: true }) from 'sygnal' turns them on.
// (Runs against dist/: `npm run build` first.)
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const dist = (file) => fileURLToPath(new URL(`../../dist/${file}`, import.meta.url))

if (typeof globalThis.window === 'undefined') globalThis.window = undefined

describe("strict mode in the built entries", () => {
  it('keeps the strict checks and SYG5xx severities out of the main bundle', () => {
    const main = readFileSync(dist('index.esm.js'), 'utf8')
    const entry = readFileSync(dist('diagnostics.esm.js'), 'utf8')
    for (const marker of ["uses the 'ACTION | SINK' shorthand", 'returned the unchanged state object', 'positional arguments', 'SYG501']) {
      expect(entry).toContain(marker)
      expect(main).not.toContain(marker)
    }
  })

  it('renderComponent({ strict: true }) reports SYG501/SYG504 with the dist checks; off by default', async () => {
    const sygnal = await import('sygnal')
    const checks = await import('sygnal/diagnostics')
    expect(checks.isStrictEnabled()).toBe(false)
    expect(checks.getCodeInfo('SYG504')).toMatchObject({ severity: 'warn' })

    function Card(props, state) { return sygnal.createElement('div', null, 'x') }
    Card.initialState = { n: 0 }
    Card.model = { 'PING | EFFECT': () => {} }

    let t = sygnal.renderComponent(Card)
    await new Promise(r => setTimeout(r, 30))
    t.dispose()
    expect(t.diagnostics.filter(d => /^SYG5/.test(d.code))).toEqual([])

    t = sygnal.renderComponent(Card, { strict: true })
    await new Promise(r => setTimeout(r, 30))
    t.dispose()
    expect(t.diagnostics.filter(d => /^SYG5/.test(d.code)).map(d => [d.code, d.severity]).sort())
      .toEqual([['SYG501', 'warn'], ['SYG504', 'warn']])
    expect(checks.isStrictEnabled()).toBe(false)
  })
})
