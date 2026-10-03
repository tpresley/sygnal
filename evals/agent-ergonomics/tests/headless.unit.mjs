// Unit tests for the headless runner helpers, transcript stats on headless
// transcripts, and trial planning. Run: node --test evals/agent-ergonomics/tests/*.unit.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { buildClaudeArgs, trialEnv, stampLine, summarizeRun, parseJsonl, trialFiles, DEFAULT_TOOLS } from '../lib/headless.mjs'
import { transcriptStats, dirAliases, mentionsHidden } from '../lib/transcript.mjs'
import { taskSelector, buildPlan, estimate, trialName } from '../lib/plan.mjs'

import { headlessTranscript, DEST } from './fixtures-headless.mjs'

test('buildClaudeArgs: same prompt, stream-json, pre-approved tools, no MCP, optional model', () => {
  const a = buildClaudeArgs({ prompt: 'do it', model: 'sonnet' })
  assert.deepEqual(a.slice(0, 2), ['-p', 'do it'])
  assert.ok(a.includes('stream-json') && a.includes('--verbose'))
  assert.equal(a[a.indexOf('--permission-mode') + 1], 'acceptEdits')
  assert.equal(a[a.indexOf('--tools') + 1], DEFAULT_TOOLS.join(','))
  assert.equal(a[a.indexOf('--allowedTools') + 1], DEFAULT_TOOLS.join(','))
  assert.ok(a.includes('--strict-mcp-config') && a.includes('--no-session-persistence'))
  assert.equal(a[a.indexOf('--model') + 1], 'sonnet')
  const b = buildClaudeArgs({ prompt: 'x', tools: 'Bash, Read', effort: 'high', maxBudgetUsd: 2 })
  assert.ok(!b.includes('--model'))
  assert.equal(b[b.indexOf('--tools') + 1], 'Bash,Read')
  assert.equal(b[b.indexOf('--effort') + 1], 'high')
  assert.equal(b[b.indexOf('--max-budget-usd') + 1], '2')
  assert.throws(() => buildClaudeArgs({}))
})

test('trialEnv drops host-session variables and keeps credentials', () => {
  const env = trialEnv({ PATH: '/bin', HOME: '/h', ANTHROPIC_API_KEY: 'k', CLAUDECODE: '1', CLAUDE_CODE_ENTRYPOINT: 'x', CLAUDE_CODE_SESSION_ID: 's', CLAUDE_EFFORT: 'medium', CLAUDE_AGENT_SDK_VERSION: '1', AI_AGENT: 'y' })
  assert.deepEqual(Object.keys(env).sort(), ['ANTHROPIC_API_KEY', 'HOME', 'PATH'])
})

test('stampLine adds a timestamp once and drops non-JSON', () => {
  const now = new Date('2026-10-01T00:00:00Z')
  assert.equal(JSON.parse(stampLine('{"type":"assistant"}', now)).timestamp, now.toISOString())
  assert.equal(JSON.parse(stampLine('{"type":"x","timestamp":"2020-01-01T00:00:00Z"}', now)).timestamp, '2020-01-01T00:00:00Z')
  assert.equal(stampLine('not json', now), null)
  assert.equal(stampLine('   ', now), null)
})

test('summarizeRun reads model, cost, billed tokens and duration from init/result', () => {
  const s = summarizeRun(parseJsonl(headlessTranscript()))
  assert.equal(s.model, 'claude-opus-5-5')
  assert.equal(s.completed, true)
  assert.equal(s.isError, false)
  assert.equal(s.costUsd, 0.4567)
  assert.equal(s.durationMs, 25500)
  assert.equal(s.tokens, 12 + 900 + 40000 + 8000)
  assert.equal(s.outputTokens, 900)
  assert.equal(s.numTurns, 4)
  assert.equal(s.authFailed, false)
})

test('summarizeRun flags an auth failure (401 retries, no result)', () => {
  const lines = [{ type: 'system', subtype: 'init', model: 'm' }, { type: 'system', subtype: 'api_retry', error_status: 401, error: 'authentication_failed' }]
  const s = summarizeRun(lines)
  assert.equal(s.completed, false)
  assert.equal(s.authFailed, true)
  assert.equal(s.tokens, null)
})

test('trialFiles: sidecars next to the trial dir', () => {
  assert.deepEqual(trialFiles('/t/x'), { prompt: '/t/x.prompt.txt', transcript: '/t/x.transcript.jsonl', meta: '/t/x.run.json', stderr: '/t/x.stderr.log' })
})

test('transcriptStats on a headless transcript: iterations, edits, wall, usage', () => {
  const s = transcriptStats(headlessTranscript(), DEST)
  assert.equal(s.iterations, 1)
  assert.equal(s.editRounds, 1)
  assert.equal(s.edits, 1)
  assert.equal(s.toolCalls, 3)
  assert.equal(s.wallSeconds, 26)
  assert.deepEqual(s.audit, [])
  assert.equal(s.headless.costUsd, 0.4567)
  assert.equal(s.headless.tokens, 48912)
  assert.equal(s.headless.model, 'claude-opus-5-5')
})

test('transcriptStats: /tmp and /private/tmp spellings of the trial dir are the same dir', () => {
  // The prompt says /tmp/..., the agent's cwd is /private/tmp/...
  const s = transcriptStats(headlessTranscript({ dest: DEST, bashPath: DEST.replace('/private', '') }), DEST.replace('/private', ''))
  assert.deepEqual(s.audit, [])
  assert.deepEqual(dirAliases('/tmp/a'), ['/private/tmp/a', '/tmp/a'])
  assert.deepEqual(dirAliases('/private/var/x'), ['/private/var/x', '/var/x'])
  assert.deepEqual(dirAliases('/Users/x'), ['/Users/x'])
  assert.equal(mentionsHidden('cat /private/tmp/evals/agent-ergonomics-x/__hidden__/a', '/tmp/evals/agent-ergonomics-x'), true)
})

test('transcriptStats: unstamped headless output falls back to duration_ms; subagent logs have no headless block', () => {
  const raw = headlessTranscript().split('\n').filter(Boolean).map((l) => {
    const o = JSON.parse(l)
    delete o.timestamp
    return JSON.stringify(o)
  }).join('\n')
  assert.equal(transcriptStats(raw, DEST).wallSeconds, 26)
  const sub = JSON.stringify({ type: 'assistant', timestamp: '2026-10-01T00:00:00Z', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'z', name: 'Bash', input: { command: 'npm test' } }] } })
  assert.equal(transcriptStats(sub).headless, null)
})

// ---- planning

test('taskSelector: all, tiers, single ids, ranges, lists', () => {
  const pick = (spec) => [1, 6, 8, 9, 12, 13, 15, 18, 21, 22, 23, 25, 26, 28, 29, 30].filter(taskSelector(spec))
  assert.deepEqual(pick('all'), [1, 6, 8, 9, 12, 13, 15, 18, 21, 22, 23, 25, 26, 28, 29, 30])
  assert.deepEqual(pick('tier1'), [1, 6, 8])
  assert.deepEqual(pick('tier2'), [9, 12])
  assert.deepEqual(pick('tier3'), [13, 15])
  assert.deepEqual(pick('ts'), [18, 21])
  assert.deepEqual(pick('tier2,ts'), [9, 12, 18, 21])
  assert.deepEqual(pick('net'), [22, 23, 25])
  assert.deepEqual(pick('tier3,net'), [13, 15, 22, 23, 25])
  assert.deepEqual(pick('ergo'), [26, 28, 29])
  assert.deepEqual(pick('net,ergo'), [22, 23, 25, 26, 28, 29])
  assert.deepEqual(pick('01'), [1])
  assert.deepEqual(pick('6-9'), [6, 8, 9])
  assert.deepEqual(pick('01,tier3'), [1, 13, 15])
  assert.deepEqual(pick('13-search'), [13])
  assert.throws(() => taskSelector('foo'))
})

test('buildPlan: arms, missing tasks per arm, resume states', () => {
  const tasksByArm = { sygnal: ['01-a', '06-b', '13-new'], react: ['01-a', '13-new'] }
  const scored = [{ task: '01-a', arm: 'sygnal', trial: 1 }]
  const states = { 'react-01-t1': 'ran', 'react-01-t2': 'prepared', 'sygnal-06-t2': 'partial' }
  const p = buildPlan({ arms: ['sygnal', 'react'], tasksByArm, tasksSpec: 'all', trials: 2, scored, state: (n) => states[n] ?? 'none' })
  const act = Object.fromEntries(p.items.map((i) => [i.name, i.action]))
  assert.deepEqual(act, {
    'sygnal-01-t1': 'skip', 'sygnal-01-t2': 'new', 'react-01-t1': 'score', 'react-01-t2': 'run',
    'sygnal-06-t1': 'new', 'sygnal-06-t2': 'redo',
    'sygnal-13-t1': 'new', 'sygnal-13-t2': 'new', 'react-13-t1': 'new', 'react-13-t2': 'new',
  })
  assert.deepEqual(p.unavailable, [{ arm: 'react', taskNum: '06' }])
  assert.equal(trialName('react', '13-new', 3), 'react-13-t3')
  const q = buildPlan({ arms: ['react'], tasksByArm, tasksSpec: '01', trials: 1, startTrial: 4 })
  assert.deepEqual(q.items.map((i) => i.name), ['react-01-t4'])
})

test('estimate: per-task history, arm fallback, unknown cost, concurrency', () => {
  const items = [
    { arm: 'sygnal', task: '01-a', action: 'new' },
    { arm: 'sygnal', task: '02-b', action: 'new' },
    { arm: 'react', task: '01-a', action: 'score' },
    { arm: 'react', task: '01-a', action: 'skip' },
  ]
  const history = [
    { arm: 'sygnal', task: '01-a', costUsd: 1, durationMs: 60000 },
    { arm: 'sygnal', task: '01-a', costUsd: 3, durationMs: 120000 },
    { arm: 'sygnal', task: '03-c', wallSeconds: 30 },
  ]
  const e = estimate(items, history, { concurrency: 2, overheadSec: 0 })
  assert.equal(e.trials, 3)
  assert.equal(e.agentRuns, 2)
  assert.equal(e.scoreOnly, 1)
  assert.equal(e.costUsd, 4) // task mean 2 for 01, arm mean 2 for 02
  assert.equal(e.costCoverage, 1)
  assert.equal(e.agentSeconds, 90 + 70) // 01: mean(60,120); 02: arm mean(60,120,30)
  assert.equal(e.wallSeconds, Math.round((160 + 3 * 15) / 2))
  assert.equal(estimate(items, []).costUsd, null)
})
