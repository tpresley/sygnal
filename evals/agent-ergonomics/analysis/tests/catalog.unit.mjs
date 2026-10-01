import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { CATALOG, matchResult, matchReport, matchWorkaround, frictionIds, trackerStatus } from '../catalog.mjs'
import { FAIL_B007, FAIL_B006, GUARD } from './fixtures.mjs'

test('catalog entries are well-formed and unique', () => {
  const ids = CATALOG.map((e) => e.id)
  assert.equal(new Set(ids).size, ids.length)
  for (const e of CATALOG) {
    assert.ok(['defect', 'harness', 'suspect', 'pitfall', 'docs'].includes(e.kind), e.id)
    for (const k of ['result', 'report', 'workaround']) assert.ok(Array.isArray(e[k]), `${e.id}.${k}`)
  }
})

test('B-007 signatures in results', () => {
  assert.ok(matchResult(FAIL_B007, 'sygnal').includes('B-007'))
  assert.ok(matchResult('ReferenceError: app is not defined', 'sygnal').includes('B-007'))
  assert.ok(matchResult('20:     app = const __sygnal = run(App);\n              ^', 'sygnal').includes('B-007'))
  assert.ok(!matchResult(FAIL_B007, 'react').includes('B-007'), 'Sygnal-only entries do not match the React arm')
})

test('B-006, B-011, G-018, harness guard and RxJS signatures', () => {
  assert.ok(matchResult(FAIL_B006, 'sygnal').includes('B-006'))
  assert.ok(matchResult('TypeError: DOM.input(...).value is not a function', 'sygnal').includes('B-006'))
  assert.ok(matchResult("AssertionError: expected 'DetailsFix login bug' not to contain 'Select a task'", 'sygnal').includes('B-011'))
  assert.ok(matchResult('expected \'<div class="rating food" data-sygnal-ready="true">\'', 'sygnal').includes('G-018'))
  assert.deepEqual(matchResult(GUARD, 'react'), ['HARNESS-GUARD'])
  assert.ok(matchResult('TypeError: stream.pipe is not a function', 'sygnal').includes('RXJS'))
  assert.deepEqual(matchResult('AssertionError: expected 3 to be 2', 'sygnal'), [])
})

test('report matching', () => {
  const r = matchReport(
    'Problems: the `sygnal/vite` plugin rewrites any `run(` call, so `__sygnal is not defined`. ' +
      'Its mock DOM returns plain streams, so `DOM.input(...).value()` throws "value is not a function". ' +
      'An action passed to simulateAction right after renderComponent returns is silently dropped. ' +
      '`simulateAction` only runs the state update; EVENTS never fires that way. ' +
      "Sygnal's `driverFromAsync` only logs a failed request and never passes it on to the app.",
    'sygnal'
  )
  for (const id of ['B-007', 'B-006', 'G-016', 'G-015', 'B-005']) assert.ok(r.includes(id), id)
  assert.deepEqual(matchReport('Every task row now has a Pin button.', 'sygnal'), [])
})

test('workaround matching', () => {
  assert.ok(matchWorkaround("import { run as startApp } from 'sygnal'", 'sygnal').includes('B-007'))
  assert.ok(matchWorkaround("import * as S from 'sygnal'\nS.run(App)", 'sygnal').includes('B-007'))
  assert.ok(matchWorkaround('// import.meta.hot -- keeps the plugin away', 'sygnal').includes('B-007'))
  assert.ok(matchWorkaround("const run = sygnal['ru' + 'n']", 'sygnal').includes('B-007'))
  assert.deepEqual(matchWorkaround("import { run } from 'sygnal'", 'sygnal'), [])
})

test('frictionIds: defects always count; suspects only when the report confirms', () => {
  assert.deepEqual(frictionIds(['B-007'], []), ['B-007'])
  assert.deepEqual(frictionIds(['G-016', 'G-015'], []), [])
  assert.deepEqual(frictionIds(['G-016', 'G-015'], ['G-015']), ['G-015'])
  assert.deepEqual(frictionIds(['ISOLATION'], ['ISOLATION']), [], 'pitfalls are the agent’s bug, not friction')
  assert.deepEqual(frictionIds(['HARNESS-GUARD'], []), ['HARNESS-GUARD'])
})

test('trackerStatus parses the tracker table', () => {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'fa-')), 'status.md')
  fs.writeFileSync(
    f,
    [
      '| ID | Found | Severity | Area | Description | Status / Owner |',
      '|---|---|---|---|---|---|',
      '| B-005 | 0A | med | x | swallows | Open → 1F |',
      '| B-007 | B | **high** | y | rewrites | ✅ Fixed in 0B review fixes (`44daa86`) |',
      '| G-011 | 0B | med | z | types | Partly fixed (`44daa86`): more |',
    ].join('\n')
  )
  const s = trackerStatus(f)
  assert.equal(s['B-005'].status, 'open')
  assert.equal(s['B-007'].status, 'fixed')
  assert.equal(s['G-011'].status, 'partly fixed')
  assert.deepEqual(trackerStatus('/nonexistent/file.md'), {})
})
