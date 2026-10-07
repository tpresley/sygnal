// node --test evals/agent-ergonomics/analysis/tests/mod.unit.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { modTask, modSummary, modTotals, renderMod } from '../mod.mjs'
import { testGroup, applyOverlayDir, OVERLAY_DELETE_FILE } from '../../lib/common.mjs'

test('modTask: level and operation from the task number', () => {
  assert.deepEqual(modTask('35-pantry-search'), { level: 'S', op: 'add' })
  assert.deepEqual(modTask('39-pipeline-stages'), { level: 'M', op: 'change' })
  assert.deepEqual(modTask('43-expenses-remove-settings'), { level: 'L', op: 'remove' })
  assert.equal(modTask('34-sortable-playlist'), null)
})

test('testGroup: audit / project / behavior by title prefix', () => {
  assert.equal(testGroup('audit: no code for the tabs is left'), 'audit')
  assert.equal(testGroup("project: the project's own tests pass"), 'project')
  assert.equal(testGroup('filters by name'), 'behavior')
})

test('modSummary + modTotals: pass split into behavior, project suite and audit', () => {
  const rec = (task, arm, trial, pass, groups, extra = {}) => ({
    task, arm, trial, pass, groups,
    behaviorPass: groups.behavior.passed === groups.behavior.total,
    costUsd: 0.2, durationMs: 60000, iterations: 3, editRounds: 2, ...extra,
  })
  const ok = { passed: 1, total: 1 }
  const bad = { passed: 0, total: 1 }
  const records = [
    rec('37-pantry-remove-tabs', 'sygnal', 1, true, { behavior: { passed: 5, total: 5 }, audit: ok, project: ok }),
    rec('37-pantry-remove-tabs', 'sygnal', 2, false, { behavior: { passed: 5, total: 5 }, audit: bad, project: ok }),
    rec('37-pantry-remove-tabs', 'react', 1, false, { behavior: { passed: 4, total: 5 }, audit: ok, project: bad }),
    rec('35-pantry-search', 'react', 1, true, { behavior: { passed: 7, total: 7 }, project: ok }),
    { task: '30-checkout-form', arm: 'sygnal', trial: 1, pass: true },
  ]
  const rows = modSummary(records)
  assert.deepEqual(rows.map((r) => `${r.task}/${r.arm}`), ['35-pantry-search/react', '37-pantry-remove-tabs/sygnal', '37-pantry-remove-tabs/react'])
  const sy = rows[1]
  assert.deepEqual([sy.pass, sy.behavior, sy.project, sy.audit], [{ ok: 1, of: 2 }, { ok: 2, of: 2 }, { ok: 2, of: 2 }, { ok: 1, of: 2 }])
  assert.equal(rows[0].audit, null)
  const totals = modTotals(rows)
  assert.deepEqual(totals.react.project, { ok: 1, of: 2 })
  assert.deepEqual(totals['sygnal remove'].audit, { ok: 1, of: 2 })
  assert.match(renderMod('x', rows), /\| 37-pantry-remove-tabs \| S \| remove \| sygnal \| 1\/2 \| 2\/2 \| 2\/2 \| 1\/2 \|/)
})

test('applyOverlayDir: copies the overlay, then deletes what .overlay-delete lists', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mod-overlay-'))
  const proj = path.join(tmp, 'proj')
  const over = path.join(tmp, 'over')
  fs.mkdirSync(path.join(proj, 'src'), { recursive: true })
  fs.writeFileSync(path.join(proj, 'src', 'Log.jsx'), 'x')
  fs.writeFileSync(path.join(proj, 'src', 'App.jsx'), 'old')
  fs.mkdirSync(path.join(over, 'src'), { recursive: true })
  fs.writeFileSync(path.join(over, 'src', 'App.jsx'), 'new')
  fs.writeFileSync(path.join(over, OVERLAY_DELETE_FILE), '# the log goes\nsrc/Log.jsx\n')
  assert.deepEqual(applyOverlayDir(over, proj), ['src/Log.jsx'])
  assert.equal(fs.readFileSync(path.join(proj, 'src', 'App.jsx'), 'utf8'), 'new')
  assert.equal(fs.existsSync(path.join(proj, 'src', 'Log.jsx')), false)
  assert.equal(fs.existsSync(path.join(proj, OVERLAY_DELETE_FILE)), false)
  fs.writeFileSync(path.join(over, OVERLAY_DELETE_FILE), '../outside\n')
  assert.throws(() => applyOverlayDir(over, proj), /outside the project/)
  fs.rmSync(tmp, { recursive: true, force: true })
})
