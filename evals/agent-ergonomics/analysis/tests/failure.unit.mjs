// PLAN-5 4-D: Sygnal-skill attribution (a bundled `run` / `dataviz` Skill call is not a skill read)
// and the automatic failure category.
import test from 'node:test'
import assert from 'node:assert/strict'
import { isSygnalSkillCall, skillNameOf, skillReadsOfCall, skillUsage } from '../lib/skill.mjs'
import { basePhase, learnTopic } from '../lib/classify.mjs'
import { parseTranscriptLines } from '../lib/parse.mjs'
import { buildTimeline } from '../lib/timeline.mjs'
import { autoFailureCategory } from '../lib/failure.mjs'

const skill = { dir: '/x', files: { 'SKILL.md': { text: '# S\n', lines: 2, bytes: 41000, sections: [] } } }
const call = (input) => ({ name: 'Skill', input })

test('isSygnalSkillCall: only sygnal-* skills (an unnamed call still counts)', () => {
  assert.equal(isSygnalSkillCall(call({ skill: 'sygnal-dev' })), true)
  assert.equal(isSygnalSkillCall(call({ skill: 'sygnal-dev', args: 'forms' })), true)
  assert.equal(isSygnalSkillCall(call({ command: '/sygnal-dev' })), true)
  assert.equal(isSygnalSkillCall(call({})), true)
  assert.equal(isSygnalSkillCall(call({ skill: 'run' })), false)
  assert.equal(isSygnalSkillCall(call({ skill: 'dataviz' })), false)
  assert.equal(isSygnalSkillCall({ name: 'Read', input: { skill: 'sygnal-dev' } }), false)
  assert.equal(skillNameOf(call({ command: '/run' })), 'run')
})

test('a bundled skill is neither a skill read nor learn time', () => {
  assert.deepEqual(skillReadsOfCall(call({ skill: 'run' }), skill), [])
  assert.equal(skillReadsOfCall(call({ skill: 'sygnal-dev' }), skill)[0].bytes, 41000)
  assert.equal(basePhase(call({ skill: 'run' })), 'other')
  assert.equal(basePhase(call({ skill: 'sygnal-dev' })), 'learn')
  assert.notEqual(learnTopic(call({ skill: 'run' })), 'skill-load')
  assert.equal(learnTopic(call({ skill: 'sygnal-dev' })), 'skill-load')
})

test('parse + timeline: a `run` skill call charges no skill-load and is listed in otherSkills', () => {
  const t0 = Date.parse('2026-10-06T00:00:00Z')
  const at = (s) => new Date(t0 + s * 1000).toISOString()
  const line = (o) => JSON.stringify(o)
  const assistant = (s, id, content) => line({ type: 'assistant', timestamp: at(s), message: { id, model: 'm', role: 'assistant', content, usage: { input_tokens: 1, output_tokens: 1 } } })
  const result = (s, id, text) => line({ type: 'user', timestamp: at(s), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: text }] } })
  const lines = [
    line({ type: 'user', timestamp: at(0), message: { role: 'user', content: 'do the task' } }),
    assistant(1, 'm1', [{ type: 'tool_use', id: 't1', name: 'Skill', input: { skill: 'run' } }]),
    result(2, 't1', 'Launching skill: run'),
    assistant(12, 'm2', [{ type: 'tool_use', id: 't2', name: 'Bash', input: { command: 'ls' } }]),
    result(13, 't2', 'src'),
    assistant(14, 'm3', [{ type: 'text', text: 'Done.' }]),
  ]
  const parsed = parseTranscriptLines(lines)
  assert.equal(parsed.skillInvoked, false)
  assert.deepEqual(parsed.otherSkills, ['run'])
  const u = skillUsage(parsed, skill)
  assert.equal(u.skillBytes, 0)
  assert.deepEqual(u.otherSkills, ['run'])
  const tl = buildTimeline(parsed, { arm: 'react' })
  assert.equal(tl.learn?.['skill-load'] ?? 0, 0)
})

test('autoFailureCategory', () => {
  const diag = (...codes) => ({ diagnostics: codes.map((code) => ({ code, severity: 'warn' })) })
  assert.equal(autoFailureCategory(null, null), null)
  assert.equal(autoFailureCategory({ pass: true, failureCategory: 'none' }, null), null)
  assert.deepEqual(autoFailureCategory({ pass: false, failureCategory: 'wiring' }, diag('SYG104')), { category: 'wiring', source: 'manual', codes: [] })
  assert.deepEqual(autoFailureCategory({ pass: false, failureCategory: null }, diag('SYG410', 'SYG104')), { category: 'isolation', source: 'final-code', codes: ['SYG104'] })
  assert.deepEqual(autoFailureCategory({ pass: false, failureCategory: null }, diag('SYG110')), { category: 'wiring', source: 'final-code', codes: ['SYG110'] })
  assert.deepEqual(autoFailureCategory({ pass: false, failureCategory: null }, diag('SYG222')), { category: 'reducer-shape', source: 'final-code', codes: ['SYG222'] })
  assert.deepEqual(autoFailureCategory({ pass: false }, { diagnostics: [{ code: 'SYG104', severity: 'info' }, { code: 'SYG702', severity: 'warn' }] }), { category: 'other', source: 'none-found', codes: [] })
  assert.deepEqual(autoFailureCategory({ pass: false }, null), { category: 'other', source: 'none-found', codes: [] })
})
