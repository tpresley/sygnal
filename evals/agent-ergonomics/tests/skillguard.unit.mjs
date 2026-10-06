// Built-in skill block (D234, PLAN-5 4-E2): trials must not see Claude Code's own skills
// (`run`, `dataviz`, ...), only their variant's skill. The fake CLI lists built-in skills
// (FAKE_CLAUDE_BUILTIN_SKILLS) the way CLI 2.1.287 does: disableBundledSkills leaves `design`,
// `doctor` and `plugin-authoring`, skillOverrides 'off' removes any.
// Run: node --test evals/agent-ergonomics/tests/*.unit.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildClaudeArgs, buildPreflightArgs, trialSettings, writeTrialSettings, checkSkillGuard, BUILTIN_SKILLS, SKILL_GUARD } from '../lib/headless.mjs'
import { runTrial, preflight } from '../lib/runner.mjs'
import { skillGuardNote } from '../analysis/lib/report.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const FAKE = path.join(HERE, 'fake-claude.mjs')
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'skillguard-'))
const mk = (name) => {
  const dest = path.join(root, name)
  fs.mkdirSync(dest)
  fs.writeFileSync(path.join(dest, 'package.json'), '{"scripts":{"test":"true"}}')
  fs.writeFileSync(`${dest}.prompt.txt`, 'do it')
  return dest
}
// A variant skill dir as --add-dir sees it: <root>/.claude/skills/sygnal-dev/SKILL.md
const skillRoot = path.join(root, 'skillroot')
fs.mkdirSync(path.join(skillRoot, '.claude', 'skills', 'sygnal-dev'), { recursive: true })
fs.writeFileSync(path.join(skillRoot, '.claude', 'skills', 'sygnal-dev', 'SKILL.md'), '# sygnal-dev')
const withEnv = (vars, fn) => {
  const old = { ...process.env }
  Object.assign(process.env, vars)
  return fn().finally(() => {
    for (const k of Object.keys(vars)) if (old[k] === undefined) delete process.env[k]
    else process.env[k] = old[k]
  })
}
const BUILTINS_SEEN = 'run,dataviz,verify,design,doctor,plugin-authoring'

test('trialSettings: bundled skills off, every built-in skill overridden off and denied', () => {
  const s = trialSettings()
  assert.deepEqual(Object.keys(s), ['disableBundledSkills', 'skillOverrides', 'permissions'])
  assert.equal(s.disableBundledSkills, true)
  assert.deepEqual(Object.keys(s.skillOverrides), BUILTIN_SKILLS)
  assert.ok(Object.values(s.skillOverrides).every((v) => v === 'off'))
  assert.deepEqual(s.permissions, { deny: BUILTIN_SKILLS.map((n) => `Skill(${n})`) })
  // The names the D228 Haiku trials used, and the ones disableBundledSkills alone leaves on CLI 2.1.287.
  for (const n of ['run', 'dataviz', 'design', 'doctor', 'plugin-authoring']) assert.ok(s.permissions.deny.includes(`Skill(${n})`), n)
  // The Sygnal skill is never touched, and an allowed name is left out of both lists.
  assert.ok(!JSON.stringify(s).includes('sygnal-dev'))
  const a = trialSettings({ allowSkills: ['run'] })
  assert.equal(a.skillOverrides.run, undefined)
  assert.ok(!a.permissions.deny.includes('Skill(run)'))
  assert.equal(a.permissions.deny.length, BUILTIN_SKILLS.length - 1)
})

test('writeTrialSettings writes <dest>.settings.json; the args pass it with --settings', () => {
  const dest = path.join(root, 'x')
  const file = writeTrialSettings(dest, trialSettings())
  assert.equal(file, `${dest}.settings.json`)
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), trialSettings())
  const args = buildClaudeArgs({ prompt: 'p', settings: file, settingSources: 'project,local' })
  assert.equal(args[args.indexOf('--settings') + 1], file)
  // The guard does not narrow the tool list: the React arm keeps its normal tools (Skill included).
  assert.ok(args[args.indexOf('--tools') + 1].split(',').includes('Skill'))
  assert.ok(!buildClaudeArgs({ prompt: 'p' }).includes('--settings'))
  const pf = buildPreflightArgs({ settings: JSON.stringify(trialSettings()) })
  assert.deepEqual(JSON.parse(pf[pf.indexOf('--settings') + 1]), trialSettings())
})

test('checkSkillGuard flags a built-in skill left loaded, never the allowed ones', () => {
  assert.equal(checkSkillGuard(['sygnal-dev']), null)
  assert.equal(checkSkillGuard([]), null)
  assert.equal(checkSkillGuard(null), null)
  assert.match(checkSkillGuard(['sygnal-dev', 'design']), /design/)
  assert.equal(checkSkillGuard(['run'], ['run']), null)
})

test('runTrial (fake CLI): the guard reaches the CLI, the trial sees only the variant skill, the meta records it', async () => {
  const log = path.join(root, 'argv.jsonl')
  const iso = { settingSources: 'project,local', addDirs: [skillRoot] }
  await withEnv({ FAKE_CLAUDE_BUILTIN_SKILLS: BUILTINS_SEEN, FAKE_CLAUDE_ARGV_LOG: log }, async () => {
    const dest = mk('sygnal-01-t1')
    const syg = await runTrial({ dest, model: 'claude-opus-5-5', claudeBin: FAKE, isolation: iso, allowSkills: ['sygnal-dev'] })
    assert.equal(syg.agentRan, true)
    assert.deepEqual(syg.skills, ['sygnal-dev'])
    assert.equal(syg.skillGuard, SKILL_GUARD)
    assert.equal(syg.settingsFile, `${dest}.settings.json`)
    assert.deepEqual(JSON.parse(fs.readFileSync(syg.settingsFile, 'utf8')), trialSettings({ allowSkills: ['sygnal-dev'] }))
    const argv = JSON.parse(fs.readFileSync(log, 'utf8').trim().split('\n').pop()).argv
    assert.equal(argv[argv.indexOf('--settings') + 1], syg.settingsFile)

    const react = await runTrial({ dest: mk('react-01-t1'), model: 'claude-opus-5-5', claudeBin: FAKE, isolation: { settingSources: 'project,local', addDirs: [] } })
    assert.deepEqual(react.skills, [])
    assert.ok(react.tools.includes('Skill') && react.tools.includes('Bash'))

    // Without the guard (the pre-D234 condition) the built-in skills are there.
    const open = await runTrial({ dest: mk('react-01-t2'), model: 'claude-opus-5-5', claudeBin: FAKE, isolation: { settingSources: 'project,local', addDirs: [] }, skillGuard: false })
    assert.deepEqual(open.skills, BUILTINS_SEEN.split(','))
    assert.equal(open.skillGuard, 0)
    assert.equal(open.settingsFile, null)
    assert.ok(!fs.existsSync(`${path.join(root, 'react-01-t2')}.settings.json`))
  })
})

test('preflight (fake CLI): with the guard its skill list is what a trial sees', async () => {
  await withEnv({ FAKE_CLAUDE_BUILTIN_SKILLS: BUILTINS_SEEN }, async () => {
    const pf = await preflight({ model: 'claude-opus-5-5', claudeBin: FAKE, isolation: { settingSources: 'project,local', addDirs: [skillRoot] }, allowSkills: ['sygnal-dev'] })
    assert.equal(pf.ok, true)
    assert.deepEqual(pf.skills, ['sygnal-dev'])
    const open = await preflight({ model: 'claude-opus-5-5', claudeBin: FAKE, isolation: { settingSources: 'project,local', addDirs: [] }, skillGuard: false })
    assert.match(checkSkillGuard(open.skills), /run, dataviz/)
  })
})

test('skillGuardNote: names the condition, and mixed runs', () => {
  assert.match(skillGuardNote([{ skillGuard: 0 }, {}]), /available in every trial/)
  assert.match(skillGuardNote([{ skillGuard: 1 }]), /blocked in every trial/)
  assert.match(skillGuardNote([{ skillGuard: 1 }, { skillGuard: 0 }]), /mixed conditions.*1 trial.*available in 1/)
})
