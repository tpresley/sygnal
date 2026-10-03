// PLAN-4 1-E: the controls conversion (lib/convert.mjs) and variant p4-ct1-b's committed
// converted starters (variants/p4-ct1-b/gen-starters.mjs --check).
// Run: node --test evals/agent-ergonomics/tests/*.unit.mjs
// The conversion runs this checkout's sygnal-check; without its dependencies
// (npm install --prefix sygnal-check) these tests are skipped.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { convertDir, checkerAvailable, listFiles, FIX_ARGS } from '../lib/convert.mjs'
import { staleFiles, CT1_TASKS, STARTERS_DIR } from '../variants/p4-ct1-b/gen-starters.mjs'

const skip = !checkerAvailable() && 'sygnal-check dependencies not installed'

test('convertDir: converts a copy (or in place) and returns only the changed files', { skip }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct1-unit-'))
  fs.mkdirSync(path.join(dir, 'src'))
  const app = [
    "function App({ state }) {",
    "  return <div><button className=\"add\">Add</button><p className=\"n\">{state.n}</p></div>",
    '}',
    'App.initialState = { n: 0 }',
    "App.intent = ({ DOM }) => ({ ADD: DOM.click('.add') })",
    'App.model = { ADD: (s) => ({ ...s, n: s.n + 1 }) }',
    'export default App',
    '',
  ].join('\n')
  fs.writeFileSync(path.join(dir, 'src', 'App.jsx'), app)
  fs.writeFileSync(path.join(dir, 'src', 'other.js'), 'export const x = 1\n')
  assert.deepEqual(FIX_ARGS, ['--fix', '--controls', '--keep-classes'])
  const { files } = convertDir(dir)
  assert.deepEqual(Object.keys(files), ['src/App.jsx'])
  assert.match(files['src/App.jsx'], /controls\(\{ Add: 'button' \}\)/)
  assert.match(files['src/App.jsx'], /<Add className="add">Add<\/Add>/, '--keep-classes keeps the class')
  assert.match(files['src/App.jsx'], /DOM\.click\(Add\)/)
  assert.equal(fs.readFileSync(path.join(dir, 'src', 'App.jsx'), 'utf8'), app, 'the source dir is untouched')
  // In place, then again: idempotent.
  assert.deepEqual(Object.keys(convertDir(dir, { inPlace: true }).files), ['src/App.jsx'])
  assert.deepEqual(convertDir(dir, { inPlace: true }).files, {})
  assert.deepEqual(listFiles(dir).sort(), ['src/App.jsx', 'src/other.js'])
})

test('p4-ct1-b: the committed converted starters match a fresh conversion of the task starters', { skip }, () => {
  assert.deepEqual(staleFiles(), [], 'regenerate: node evals/agent-ergonomics/variants/p4-ct1-b/gen-starters.mjs')
  const tasks = fs.readdirSync(STARTERS_DIR)
  for (const t of tasks) assert.ok(CT1_TASKS.includes(t.slice(0, 2)), t)
  // Every converted file keeps the classes the hidden tests select by.
  for (const rel of listFiles(STARTERS_DIR)) {
    const text = fs.readFileSync(path.join(STARTERS_DIR, rel), 'utf8')
    const spec = text.match(/controls\(\{([^}]*)\}\)/)
    assert.ok(spec, `${rel}: no controls() call`)
    for (const [, key] of spec[1].matchAll(/(\w+):/g)) {
      const tags = [...text.matchAll(new RegExp(`<${key}\\b[^>]*>`, 'g'))].map((m) => m[0])
      assert.ok(tags.length, `${rel}: <${key}> is not rendered`)
      for (const tag of tags) assert.match(tag, /className=/, `${rel}: ${tag} lost its className`)
    }
  }
})
