// PLAN-2 3-H: run variants (lib/variant.mjs) and the isolation flags they give the CLI.
// Run: node --test evals/agent-ergonomics/tests/*.unit.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import {
  loadVariant, validateVariant, resolveVariant, materializeVariant, applyOverlay, applyPrompt, deepMerge,
  claudeIsolation, expectedSkills, checkSkills, canonicalJson, hashDir, resolveSpecPath, describeVariant,
} from '../lib/variant.mjs'
import { buildClaudeArgs, buildPreflightArgs } from '../lib/headless.mjs'
import { runTrial, preflight } from '../lib/runner.mjs'
import { EVAL_ROOT, REPO_ROOT } from '../lib/common.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const FAKE = path.join(HERE, 'fake-claude.mjs')
// The git-ref tests need the v5.4.0 tag (absent in a shallow clone).
const HAS_TAG = spawnSync('git', ['-C', REPO_ROOT, 'rev-parse', '--verify', '-q', 'v5.4.0^{commit}']).status === 0
const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p))

/** A throwaway "repo" with a skill dir, an overlay dir and a package dir. */
function fixtureRepo() {
  const root = tmp('variant-repo-')
  fs.mkdirSync(path.join(root, 'skills', 'sygnal-dev', 'references'), { recursive: true })
  fs.writeFileSync(path.join(root, 'skills', 'sygnal-dev', 'SKILL.md'), '---\nname: sygnal-dev\n---\nv1\n')
  fs.writeFileSync(path.join(root, 'skills', 'sygnal-dev', 'references', 'x.md'), 'ref\n')
  fs.mkdirSync(path.join(root, 'overlay', 'src'), { recursive: true })
  fs.writeFileSync(path.join(root, 'overlay', 'src', 'extra.js'), 'export const x = 1\n')
  fs.mkdirSync(path.join(root, 'tool'))
  fs.writeFileSync(path.join(root, 'tool', 'package.json'), '{"name":"tool","version":"1.0.0"}')
  return root
}

test('validateVariant: accepts the shipped variants and rejects typos and bad shapes', async () => {
  for (const f of fs.readdirSync(path.join(EVAL_ROOT, 'variants'))) {
    const v = await loadVariant(path.join(EVAL_ROOT, 'variants', f), { evalRoot: EVAL_ROOT })
    assert.ok(v.name && v.spec, f)
  }
  const bad = [
    { skil: 'none' },
    { sygnal: 'main' },
    { sygnal: { tarball: 'a.tgz', npm: 'x' } },
    { skill: { dir: 'a', gitRef: 'v1', path: 'b' } },
    { skill: { gitRef: 'v1' } },
    { overlay: { both: {} } },
    { overlay: { sygnal: { file: {} } } },
    { overlay: { sygnal: { files: { '../escape.txt': 'x' } } } },
    { overlay: { sygnal: { files: { '/abs.txt': 'x' } } } },
    { overlay: { sygnal: { packs: { x: { dir: 'd', dependency: 'peer' } } } } },
    { prompt: { suffix: 1 } },
    { prompt: { arms: ['vue'] } },
    { mcp: { mcpServers: {} } },
    { mcp: { mcpServers: { 'a b': { command: 'x' } } } },
    { model: 5 },
  ]
  for (const b of bad) assert.throws(() => validateVariant(b), /Variant spec/, JSON.stringify(b))
  assert.doesNotThrow(() => validateVariant({ skill: 'none', prompt: { suffix: 'x' } }))
})

test('loadVariant: by name from variants/, or by path; unknown names list the known ones', async () => {
  const v = await loadVariant('branch', { evalRoot: EVAL_ROOT })
  assert.equal(v.name, 'branch')
  assert.equal(v.file, path.join(EVAL_ROOT, 'variants', 'branch.json'))
  await assert.rejects(() => loadVariant('nope', { evalRoot: EVAL_ROOT }), /known: .*baseline-5\.4\.0/)
  const dir = tmp('variant-mjs-')
  fs.writeFileSync(path.join(dir, 'x.mjs'), 'export default { skill: "none", prompt: { prefix: "P" } }\n')
  const m = await loadVariant(path.join(dir, 'x.mjs'), { evalRoot: EVAL_ROOT })
  assert.equal(m.name, 'x')
  assert.equal(m.spec.prompt.prefix, 'P')
})

test('resolveVariant: the hash pins content, model and effort, not paths', () => {
  const repo = fixtureRepo()
  const spec = { skill: { dir: 'skills/sygnal-dev' }, overlay: { sygnal: { dir: 'overlay' } } }
  const a = resolveVariant({ name: 'v', file: null, spec }, { repoRoot: repo, model: 'claude-opus-5-5' })
  const b = resolveVariant({ name: 'v', file: null, spec }, { repoRoot: repo, model: 'claude-opus-5-5' })
  assert.equal(a.hash, b.hash)
  assert.match(a.hash, /^[0-9a-f]{12}$/)
  // Same content elsewhere: same hash.
  const repo2 = fixtureRepo()
  assert.equal(resolveVariant({ name: 'v', file: null, spec }, { repoRoot: repo2, model: 'claude-opus-5-5' }).hash, a.hash)
  // Content, model and effort each change it.
  assert.notEqual(resolveVariant({ name: 'v', file: null, spec }, { repoRoot: repo, model: 'claude-sonnet-5-5' }).hash, a.hash)
  assert.notEqual(resolveVariant({ name: 'v', file: null, spec }, { repoRoot: repo, model: 'claude-opus-5-5', effort: 'high' }).hash, a.hash)
  fs.appendFileSync(path.join(repo, 'skills', 'sygnal-dev', 'references', 'x.md'), 'more\n')
  assert.notEqual(resolveVariant({ name: 'v', file: null, spec }, { repoRoot: repo, model: 'claude-opus-5-5' }).hash, a.hash)
  // The spec's model is used unless the caller overrides it.
  assert.equal(resolveVariant({ name: 'v', file: null, spec: { model: 'claude-haiku-4-5' } }, { repoRoot: repo }).model, 'claude-haiku-4-5')
  assert.throws(() => resolveVariant({ name: 'v', file: null, spec: { skill: { dir: 'missing' } } }, { repoRoot: repo }), /no SKILL\.md/)
  assert.match(describeVariant(a), /skill: sygnal-dev from dir:skills\/sygnal-dev .*isolated per trial/)
})

test('resolveVariant: a skill from a git ref pins the tree id (v5.4.0 in this repo)', { skip: !HAS_TAG && 'no v5.4.0 tag' }, () => {
  const v = resolveVariant({ name: 'b', file: null, spec: { skill: { gitRef: 'v5.4.0', path: 'skills/sygnal-dev' } } }, { repoRoot: REPO_ROOT })
  assert.match(v.skill.contentHash, /^git-tree:[0-9a-f]{40}$/)
  assert.throws(() => resolveVariant({ name: 'b', file: null, spec: { skill: { gitRef: 'v5.4.0', path: 'no/such/dir' } } }, { repoRoot: REPO_ROOT }), /git/)
})

test('resolveSpecPath: ./ and ../ are relative to the spec file, others to the repo root', () => {
  assert.equal(resolveSpecPath('skills/x', { repoRoot: '/r', specDir: '/s/v' }), '/r/skills/x')
  assert.equal(resolveSpecPath('./o', { repoRoot: '/r', specDir: '/s/v' }), '/s/v/o')
  assert.equal(resolveSpecPath('../o', { repoRoot: '/r', specDir: '/s/v' }), '/s/o')
  assert.equal(resolveSpecPath('/abs', { repoRoot: '/r', specDir: '/s/v' }), '/abs')
})

test('materializeVariant: skill copy, packs, prepare.json, MCP config; idempotent', () => {
  const repo = fixtureRepo()
  const spec = {
    skill: { dir: 'skills/sygnal-dev' },
    sygnal: { npm: 'sygnal@5.4.0' },
    overlay: {
      all: { append: { 'AGENTS.md': 'all\n' } },
      sygnal: { dir: 'overlay', files: { 'CLAUDE.md': '@AGENTS.md\n' }, append: { 'AGENTS.md': 'syg\n' }, packageJson: { scripts: { pretest: 'x' } }, packs: { tool: { dir: 'tool' } } },
    },
    prompt: { suffix: 'Add a test.', arms: ['react'] },
    mcp: { mcpServers: { 'sygnal-check': { command: 'npx', args: ['sygnal-check', 'mcp'] } } },
  }
  validateVariant(spec)
  const v = resolveVariant({ name: 'm', file: null, spec }, { repoRoot: repo })
  const out = path.join(tmp('variant-out-'), '_variant')
  const packs = []
  const npmPack = (what, dir) => {
    packs.push(what)
    fs.mkdirSync(dir, { recursive: true })
    const f = path.join(dir, `${path.basename(String(what)).replace(/@.*/, '')}-1.0.0.tgz`)
    fs.writeFileSync(f, 'tgz')
    return f
  }
  const m = materializeVariant(v, out, { repoRoot: repo, npmPack })
  assert.equal(fs.readFileSync(path.join(m.skillDir, 'SKILL.md'), 'utf8'), '---\nname: sygnal-dev\n---\nv1\n')
  assert.ok(fs.existsSync(path.join(m.skillDir, 'references', 'x.md')))
  assert.equal(m.skillRoot, path.join(out, 'skillroot'))
  assert.equal(m.skillDir, path.join(out, 'skillroot', '.claude', 'skills', 'sygnal-dev'))
  assert.match(m.tarball, /sygnal-1\.0\.0\.tgz$/)
  const prep = JSON.parse(fs.readFileSync(m.prepareSpec, 'utf8'))
  assert.equal(prep.hash, v.hash)
  assert.deepEqual(prep.arms.sygnal.overlay.append, { 'AGENTS.md': 'all\nsyg\n' }, '"all" first, then the arm')
  assert.deepEqual(prep.arms.react.overlay.append, { 'AGENTS.md': 'all\n' })
  assert.equal(prep.arms.react.overlay.vendor.length, 0)
  assert.equal(prep.arms.sygnal.overlay.vendor[0].name, 'tool')
  assert.equal(prep.arms.sygnal.overlay.vendor[0].dependency, 'devDependencies')
  assert.equal(prep.arms.sygnal.prompt, null)
  assert.deepEqual(prep.arms.react.prompt, { prefix: '', suffix: 'Add a test.' })
  assert.deepEqual(JSON.parse(fs.readFileSync(m.mcpConfig, 'utf8')).mcpServers['sygnal-check'].args, ['sygnal-check', 'mcp'])
  assert.deepEqual(m.mcpAllow, ['mcp__sygnal-check'])
  // Second call reuses the packs and the skill copy.
  materializeVariant(v, out, { repoRoot: repo, npmPack })
  assert.deepEqual(packs, ['sygnal@5.4.0', path.join(repo, 'tool')])
})

test('materializeVariant: a skill from git is extracted (v5.4.0)', { skip: !HAS_TAG && 'no v5.4.0 tag' }, () => {
  const v = resolveVariant({ name: 'g', file: null, spec: { skill: { gitRef: 'v5.4.0', path: 'skills/sygnal-dev' } } }, { repoRoot: REPO_ROOT })
  const m = materializeVariant(v, path.join(tmp('variant-git-'), '_variant'), { repoRoot: REPO_ROOT, npmPack: () => assert.fail('no pack expected') })
  assert.ok(fs.readFileSync(path.join(m.skillDir, 'SKILL.md'), 'utf8').startsWith('---'))
  assert.ok(fs.existsSync(path.join(m.skillDir, 'references', 'component-patterns.md')))
})

test('applyOverlay / applyPrompt / deepMerge', () => {
  const dest = tmp('variant-starter-')
  fs.writeFileSync(path.join(dest, 'package.json'), JSON.stringify({ name: 'eval-app', scripts: { test: 'vitest run' }, devDependencies: { vite: '^8' } }))
  fs.writeFileSync(path.join(dest, 'AGENTS.md'), 'existing')
  const src = tmp('variant-ovl-')
  fs.mkdirSync(path.join(src, 'src'))
  fs.writeFileSync(path.join(src, 'src', 'a.js'), 'a')
  const tgz = path.join(src, 'tool.tgz')
  fs.writeFileSync(tgz, 'tgz')
  const touched = applyOverlay(dest, { dirs: [src], files: { 'docs/N.md': 'n' }, append: { 'AGENTS.md': 'line\n' }, packageJson: { scripts: { pretest: 'sygnal-check --strict' }, devDependencies: { vite: null } }, vendor: [{ name: '@x/tool', tarball: tgz, dependency: 'devDependencies' }] })
  assert.ok(touched.includes('package.json'))
  assert.equal(fs.readFileSync(path.join(dest, 'src', 'a.js'), 'utf8'), 'a')
  assert.equal(fs.readFileSync(path.join(dest, 'docs', 'N.md'), 'utf8'), 'n')
  assert.equal(fs.readFileSync(path.join(dest, 'AGENTS.md'), 'utf8'), 'existing\nline\n')
  const pkg = JSON.parse(fs.readFileSync(path.join(dest, 'package.json'), 'utf8'))
  assert.deepEqual(pkg.scripts, { test: 'vitest run', pretest: 'sygnal-check --strict' })
  assert.deepEqual(pkg.devDependencies, { '@x/tool': 'file:vendor/_x_tool.tgz' })
  assert.ok(fs.existsSync(path.join(dest, 'vendor', '_x_tool.tgz')))
  assert.deepEqual(applyOverlay(dest, null), [])
  assert.equal(applyPrompt('Task.', null), 'Task.')
  assert.equal(applyPrompt('Task.', { prefix: 'Pre.', suffix: ' Add a test. ' }), 'Pre.\n\nTask.\n\nAdd a test.')
  assert.deepEqual(deepMerge({ a: { b: 1, c: 2 }, d: [1] }, { a: { c: null, e: 3 }, d: [2] }), { a: { b: 1, e: 3 }, d: [2] })
  assert.equal(canonicalJson({ b: 1, a: [{ d: 1, c: 2 }] }), '{"a":[{"c":2,"d":1}],"b":1}')
  assert.match(hashDir(src), /^[0-9a-f]{64}$/)
})

test('claudeIsolation + buildClaudeArgs: isolated skills per arm, MCP only where asked', () => {
  const v = { skill: { name: 'sygnal-dev' }, mcp: { arms: ['sygnal'] } }
  const mat = { skillRoot: '/run/_variant/skillroot', mcpConfig: '/run/_variant/mcp.json', mcpAllow: ['mcp__sygnal-check'] }
  const syg = claudeIsolation(v, mat, 'sygnal')
  assert.deepEqual(syg, { settingSources: 'project,local', addDirs: ['/run/_variant/skillroot'], mcpConfig: '/run/_variant/mcp.json', extraAllowedTools: ['mcp__sygnal-check'] })
  const react = claudeIsolation(v, mat, 'react')
  assert.deepEqual(react, { settingSources: 'project,local', addDirs: [] })
  assert.deepEqual(claudeIsolation({ skill: 'installed' }, mat, 'sygnal'), {}, 'legacy posture: the installed skill, no flags')
  assert.deepEqual(claudeIsolation(null, mat, 'sygnal'), {})
  const a = buildClaudeArgs({ prompt: 'p', ...syg })
  assert.equal(a[a.indexOf('--setting-sources') + 1], 'project,local')
  assert.equal(a[a.indexOf('--add-dir') + 1], '/run/_variant/skillroot')
  assert.equal(a[a.indexOf('--mcp-config') + 1], '/run/_variant/mcp.json')
  assert.ok(a.includes('--strict-mcp-config'))
  assert.ok(a[a.indexOf('--allowedTools') + 1].endsWith(',mcp__sygnal-check'))
  assert.ok(!a[a.indexOf('--tools') + 1].includes('mcp__'), 'MCP tools are allowed, not added to the built-in set')
  const plain = buildClaudeArgs({ prompt: 'p' })
  assert.ok(!plain.includes('--setting-sources') && !plain.includes('--add-dir') && !plain.includes('--mcp-config'))
  const pf = buildPreflightArgs({ settingSources: 'project,local', addDirs: ['/x'] })
  assert.equal(pf[pf.indexOf('--add-dir') + 1], '/x')
  // Expected skills and the init-event check.
  assert.deepEqual(expectedSkills(v, 'sygnal'), { present: ['sygnal-dev'], absent: [] })
  assert.deepEqual(expectedSkills(v, 'react'), { present: [], absent: ['sygnal-dev'] })
  assert.deepEqual(expectedSkills({ skill: 'none' }, 'sygnal'), { present: [], absent: ['sygnal-dev'] })
  assert.equal(expectedSkills({ skill: 'installed' }, 'sygnal'), null)
  assert.equal(checkSkills(expectedSkills(v, 'sygnal'), ['debug', 'sygnal-dev']), null)
  assert.match(checkSkills(expectedSkills(v, 'sygnal'), ['debug']), /not loaded/)
  assert.match(checkSkills(expectedSkills(v, 'react'), ['sygnal-dev']), /loaded but/)
  assert.equal(checkSkills(expectedSkills(v, 'sygnal'), null), null, 'an init event without a skill list is not checked')
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

test('runTrial + preflight with a variant posture: the CLI sees only the variant skill and its MCP server (fake CLI)', async () => {
  // A fake HOME with a different installed sygnal-dev skill: the isolated posture must not load it.
  const home = tmp('variant-home-')
  fs.mkdirSync(path.join(home, '.claude', 'skills', 'sygnal-dev'), { recursive: true })
  fs.writeFileSync(path.join(home, '.claude', 'skills', 'sygnal-dev', 'SKILL.md'), 'installed')
  const repo = fixtureRepo()
  const v = resolveVariant({ name: 'r', file: null, spec: { skill: { dir: 'skills/sygnal-dev' }, mcp: { mcpServers: { 'sygnal-check': { command: 'npx' } } } } }, { repoRoot: repo })
  const root = tmp('variant-run-')
  const mat = materializeVariant(v, path.join(root, '_variant'), { repoRoot: repo })
  const argvLog = path.join(root, 'argv.jsonl')
  const mk = (name) => {
    const dest = path.join(root, name)
    fs.mkdirSync(dest)
    fs.writeFileSync(path.join(dest, 'package.json'), '{"scripts":{"test":"true"}}')
    fs.writeFileSync(`${dest}.prompt.txt`, 'do it')
    return dest
  }
  await withEnv({ HOME: home, FAKE_CLAUDE_ARGV_LOG: argvLog }, async () => {
    const syg = await runTrial({ dest: mk('sygnal-01-t1'), model: 'claude-opus-5-5', claudeBin: FAKE, isolation: claudeIsolation(v, mat, 'sygnal') })
    assert.equal(syg.agentRan, true)
    assert.deepEqual(syg.skills, ['sygnal-dev'])
    assert.deepEqual(syg.mcpServers, [{ name: 'sygnal-check', status: 'connected' }])
    assert.equal(checkSkills(expectedSkills(v, 'sygnal'), syg.skills), null)
    assert.equal(syg.isolation.settingSources, 'project,local')
    const react = await runTrial({ dest: mk('react-01-t1'), model: 'claude-opus-5-5', claudeBin: FAKE, isolation: claudeIsolation(v, mat, 'react') })
    assert.deepEqual(react.skills, [])
    assert.deepEqual(react.mcpServers, [])
    // The legacy posture (no variant) sees the installed skill.
    const legacy = await runTrial({ dest: mk('sygnal-02-t1'), model: 'claude-opus-5-5', claudeBin: FAKE })
    assert.deepEqual(legacy.skills, ['sygnal-dev'])
    const pf = await preflight({ model: 'claude-opus-5-5', claudeBin: FAKE, isolation: claudeIsolation(v, mat, 'sygnal') })
    assert.equal(pf.ok, true)
    assert.deepEqual(pf.skills, ['sygnal-dev'])
  })
  const calls = fs.readFileSync(argvLog, 'utf8').trim().split('\n').map((l) => JSON.parse(l).argv)
  assert.ok(calls[0].includes('--add-dir') && calls[0].includes(mat.skillRoot))
  assert.ok(!calls[1].includes('--add-dir'))
  // Nothing was written under the fake HOME.
  assert.deepEqual(fs.readdirSync(path.join(home, '.claude')), ['skills'])
})
