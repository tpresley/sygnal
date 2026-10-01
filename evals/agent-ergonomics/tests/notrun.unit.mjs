// PLAN-2 0-B fix: runs that never reached the model are not trials, and the
// model a run used must be the one meant. Run: node --test evals/agent-ergonomics/tests/*.unit.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { summarizeRun, parseJsonl, resolveModel, checkModel, buildPreflightArgs, DEFAULT_MODEL } from '../lib/headless.mjs'
import { runTrial, preflight } from '../lib/runner.mjs'
import { transcriptStats } from '../lib/transcript.mjs'
import { parseTranscriptLines } from '../analysis/lib/parse.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
// The real v2-smoke transcript: CLI 2.1.90, invalid OAuth token, `--model opus`.
const AUTHFAIL = fs.readFileSync(path.join(HERE, 'fixtures', 'v2-smoke-authfail.transcript.jsonl'), 'utf8')
const FAKE = path.join(HERE, 'fake-claude.mjs')

test('the v2-smoke 401 run (is_error result, subtype success) is "not run", not a trial', () => {
  const s = summarizeRun(parseJsonl(AUTHFAIL))
  assert.equal(s.completed, true)
  assert.equal(s.isError, true)
  assert.equal(s.agentRan, false)
  assert.equal(s.notRunReason, 'auth')
  assert.equal(s.authFailed, true)
  assert.equal(s.turns, 0, 'the <synthetic> assistant message is not a model turn')
  assert.equal(s.model, 'claude-opus-4-6')
  assert.equal(checkModel('opus', s.model).ok, false)
  const p = parseTranscriptLines(AUTHFAIL.split('\n'))
  assert.equal(p.headless.agentRan, false, 'the analyzer skips it too')
  assert.equal(transcriptStats(AUTHFAIL).iterations, 0)
})

test('not-run detection: auth text in result only, is_error, no API time, no turns', () => {
  const init = { type: 'system', subtype: 'init', model: 'claude-opus-5-5' }
  const turn = { type: 'assistant', message: { id: 'm', model: 'claude-opus-5-5', role: 'assistant', content: [{ type: 'text', text: 'hi' }] } }
  const res = (o) => ({ type: 'result', subtype: 'success', is_error: false, duration_api_ms: 1000, result: 'done', ...o })
  assert.equal(summarizeRun([init, res({ is_error: true, result: 'Failed to authenticate. API Error: 401 OAuth access token is invalid' })]).notRunReason, 'auth')
  assert.match(summarizeRun([init, turn, res({ is_error: true, result: 'Credit balance is too low' })]).notRunReason, /^error: Credit balance/)
  assert.match(summarizeRun([init, turn, res({ duration_api_ms: 0 })]).notRunReason, /no API time/)
  assert.equal(summarizeRun([init, res({})]).notRunReason, 'no assistant turns')
  assert.equal(summarizeRun([init, { type: 'system', subtype: 'api_retry', error_status: 401, error: 'authentication_failed' }]).notRunReason, 'auth')
  const ok = summarizeRun([init, turn, res({})])
  assert.equal(ok.agentRan, true)
  assert.equal(ok.notRunReason, null)
  assert.equal(ok.authFailed, false)
  // The model a run used comes from its assistant turns first, then init.
  assert.equal(summarizeRun([{ ...init, model: 'x' }, turn, res({})]).model, 'claude-opus-5-5')
})

test('model aliases resolve to the current model; a run on another model is a mismatch', () => {
  assert.equal(DEFAULT_MODEL, 'claude-opus-5-5')
  assert.equal(resolveModel(undefined), 'claude-opus-5-5')
  assert.equal(resolveModel('opus'), 'claude-opus-5-5')
  assert.equal(resolveModel('Sonnet'), 'claude-sonnet-5-5')
  assert.equal(resolveModel('claude-haiku-4-5'), 'claude-haiku-4-5')
  assert.equal(checkModel('opus', 'claude-opus-4-6').ok, false, 'CLI 2.1.90 maps opus to 4.6')
  assert.equal(checkModel('opus', 'claude-opus-4-6').expected, 'claude-opus-5-5')
  assert.equal(checkModel('claude-opus-5-5', 'claude-opus-5-5').ok, true)
  assert.equal(checkModel('claude-opus-5-5', 'claude-opus-5-5-20260901').ok, true)
  assert.equal(checkModel('claude-opus-5-5', 'claude-opus-5-5[1m]').ok, true)
  assert.equal(checkModel('claude-opus-5-5', null).ok, false)
  const a = buildPreflightArgs({ model: 'claude-opus-5-5' })
  assert.equal(a[a.indexOf('--tools') + 1], '')
  assert.equal(a[a.indexOf('--model') + 1], 'claude-opus-5-5')
  assert.ok(a.includes('stream-json') && a.includes('--strict-mcp-config'))
})

async function withEnv(vars, fn) {
  const old = {}
  for (const k of Object.keys(vars)) {
    old[k] = process.env[k]
    process.env[k] = vars[k]
  }
  try {
    return await fn()
  } finally {
    for (const k of Object.keys(vars)) {
      if (old[k] === undefined) delete process.env[k]
      else process.env[k] = old[k]
    }
  }
}

test('runTrial: an auth failure reported in the result is not run (fake CLI)', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'notrun-'))
  const dest = path.join(root, 'react-01-t1')
  fs.mkdirSync(dest)
  fs.writeFileSync(path.join(dest, 'package.json'), '{}')
  fs.writeFileSync(`${dest}.prompt.txt`, 'do it')
  const meta = await withEnv({ FAKE_CLAUDE_MODE: 'authresult' }, () => runTrial({ dest, model: 'claude-opus-5-5', claudeBin: FAKE }))
  assert.equal(meta.agentRan, false)
  assert.equal(meta.authFailed, true)
  assert.equal(meta.notRunReason, 'auth')
  assert.equal(meta.ok, false)
})

test('runTrial: a run on a different model than requested fails the model check (fake CLI)', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'notrun-'))
  const dest = path.join(root, 'react-01-t1')
  fs.mkdirSync(dest)
  fs.writeFileSync(path.join(dest, 'package.json'), '{"scripts":{"test":"true"}}')
  fs.writeFileSync(`${dest}.prompt.txt`, 'do it')
  const meta = await withEnv({ FAKE_CLAUDE_MODELS: 'opus=claude-opus-4-6' }, () => runTrial({ dest, model: 'opus', claudeBin: FAKE }))
  assert.equal(meta.agentRan, true)
  assert.equal(meta.model, 'claude-opus-4-6')
  assert.equal(meta.modelCheck.ok, false)
  assert.equal(meta.modelCheck.expected, 'claude-opus-5-5')
})

test('preflight: ok, auth failure, an alias that resolves to an old model, no binary (fake CLI)', async () => {
  const good = await preflight({ model: 'claude-opus-5-5', claudeBin: FAKE })
  assert.equal(good.ok, true)
  assert.equal(good.modelCheck.ok, true)
  const auth = await withEnv({ FAKE_CLAUDE_MODE: 'authresult' }, () => preflight({ model: 'claude-opus-5-5', claudeBin: FAKE }))
  assert.equal(auth.ok, false)
  assert.match(auth.reason, /authentication failed/)
  const old = await withEnv({ FAKE_CLAUDE_MODELS: 'opus=claude-opus-4-6' }, () => preflight({ model: 'opus', claudeBin: FAKE }))
  assert.equal(old.ok, true)
  assert.equal(old.model, 'claude-opus-4-6')
  assert.equal(old.modelCheck.ok, false)
  const missing = await preflight({ claudeBin: '/nonexistent/claude' })
  assert.equal(missing.ok, false)
  assert.match(missing.reason, /cannot start/)
})
