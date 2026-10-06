// @vitest-environment jsdom
// PLAN-5 3-T G-528: the browser runner's console allowlist is per test (G-503), and a test's
// entry stops matching when the test ends: an allowlisted error emitted between tests (or after
// the last one) fails the run instead of counting for the previous test.
import { describe, it, expect, beforeAll, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { consoleAllowlist } from '../browser-tests/console-allowlist.mjs'

const entries = [{ test: 'A', match: [/duplicate name: x-/] }]

describe('G-528: the console allowlist', () => {
  it('matches an entry only while its test runs', () => {
    const a = consoleAllowlist(entries)
    expect(a.expected('duplicate name: x-1')).toBeUndefined()
    a.start('A')
    expect(a.expected('duplicate name: x-1')).toBe(entries[0])
    expect(a.expected('something else')).toBeUndefined()
    // the test ends: the same error between tests is unexpected
    a.start(null)
    expect(a.current).toBe(null)
    expect(a.expected('duplicate name: x-1')).toBeUndefined()
    a.start('B')
    expect(a.expected('duplicate name: x-1')).toBeUndefined()
  })

  it('is what run-headless.mjs uses', () => {
    const src = readFileSync(resolve(process.cwd(), 'browser-tests/run-headless.mjs'), 'utf8')
    expect(src).toMatch(/consoleAllowlist\(EXPECTED_CONSOLE_ERRORS\)/)
    expect(src).toMatch(/allowlist\.expected\(text\)/)
    expect(src).toMatch(/exposeFunction\('__pwTest', \(name\) => \{ allowlist\.start\(name\); \}\)/)
  })
})

describe('G-528: the harness reports when a test ends', () => {
  let runTest
  const calls = []
  beforeAll(async () => {
    document.body.innerHTML = '<div id="summary"></div><table><tbody id="results-body"></tbody></table><div id="test-containers"></div>'
    window.__pwTest = async (name) => { calls.push(name) }
    ;({ runTest } = await import('../browser-tests/src/harness.js'))
  })
  afterEach(() => { calls.length = 0 })

  it('a passing test: its name, then null', async () => {
    await runTest('C', 'passes', async () => {})
    expect(calls).toEqual(['passes', null])
  })

  it('a failing test: its name, then null', async () => {
    await runTest('C', 'fails', async () => { throw new Error('no') })
    expect(calls).toEqual(['fails', null])
  })
})
