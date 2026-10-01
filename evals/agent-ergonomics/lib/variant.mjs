// Run variants (PLAN-2 3-H): one spec file per experiment arm, so a Phase 3
// experiment is `orchestrate.mjs --variant <name>` instead of manual skill
// swaps and hand-edited starters. Unit-tested in tests/variant.unit.mjs.
//
// A spec is variants/<name>.json (or .mjs with `export default {...}`):
//
// {
//   "description": "what this variant measures",
//   "model": "claude-opus-5-5", "effort": "high",      // optional; --model / --effort override
//   "sygnal": "branch"                                 // pack this checkout (default)
//           | { "tarball": "<path.tgz>" }              // a given tarball
//           | { "npm": "sygnal@5.4.0" },               // `npm pack` from the registry
//   "skill": "installed"                               // default: whatever is in ~/.claude/skills (legacy)
//          | "none"                                    // no sygnal-dev skill at all
//          | { "dir": "skills/sygnal-dev" }            // this directory, as the sygnal-dev skill
//          | { "gitRef": "v5.4.0", "path": "skills/sygnal-dev" },   // from git
//            (+ optional "name": skill dir name, default "sygnal-dev")
//   "overlay": {                                       // applied to each starter after the copy, before npm install
//     "all" | "sygnal" | "react": {                    // "all" first, then the arm's own
//       "dir": "<path>",                               // copied over the starter
//       "files": { "AGENTS.md": "text" },              // written (replace)
//       "append": { "AGENTS.md": "text" },             // appended (file created if missing)
//       "packageJson": { "devDependencies": { "sygnal-check": "^0.1.0" }, "scripts": { "pretest": "..." } },
//                                                      // deep-merged into package.json (null deletes a key)
//       "packs": { "sygnal-check": { "dir": "sygnal-check", "dependency": "devDependencies" } }
//                                                      // npm pack <dir> once per run, vendored as vendor/<name>.tgz
//     }
//   },
//   "prompt": { "prefix": "text", "suffix": "text", "arms": ["sygnal", "react"] },   // default arms: both
//   "mcp": { "arms": ["sygnal"], "mcpServers": { "<name>": { "command": "...", "args": [...] } } }
// }
//
// Relative paths resolve against the repo root; paths starting with ./ or ../
// against the spec file's directory.
//
// Skill isolation: with a skill other than "installed", every trial runs with
// `--setting-sources project,local` (the user's settings, and with them
// ~/.claude/skills, are not loaded) and, in the Sygnal arm, `--add-dir
// <run>/_variant/skillroot`, whose .claude/skills/<name>/ holds the variant's
// skill copy. Nothing under ~/.claude is read or written for the skill; the
// React arm gets the same posture without the skill.
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

const TOP_KEYS = new Set(['description', 'model', 'effort', 'sygnal', 'skill', 'overlay', 'prompt', 'mcp'])
const OVERLAY_KEYS = new Set(['dir', 'files', 'append', 'packageJson', 'packs'])
const ARM_KEYS = ['all', 'sygnal', 'react']
const ARMS = ['sygnal', 'react']
export const ISOLATED_SETTING_SOURCES = 'project,local'

const isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x)

/** Find a variant by name (variants/<name>.json|.mjs) or path. Resolves { name, file, spec }. */
export async function loadVariant(arg, { evalRoot }) {
  let file
  if (/[\\/]/.test(arg) || /\.(json|mjs)$/.test(arg)) file = path.resolve(arg)
  else file = ['.json', '.mjs'].map((ext) => path.join(evalRoot, 'variants', `${arg}${ext}`)).find((f) => fs.existsSync(f))
  if (!file || !fs.existsSync(file)) {
    const dir = path.join(evalRoot, 'variants')
    const known = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => /\.(json|mjs)$/.test(f)).map((f) => f.replace(/\.(json|mjs)$/, '')) : []
    throw new Error(`No variant "${arg}" (known: ${known.join(', ') || 'none'})`)
  }
  const spec = file.endsWith('.mjs') ? (await import(pathToFileURL(file).href)).default : JSON.parse(fs.readFileSync(file, 'utf8'))
  const name = path.basename(file).replace(/\.(json|mjs)$/, '')
  if (!/^[\w.-]+$/.test(name)) throw new Error(`Variant name "${name}" must be a simple name`)
  validateVariant(spec)
  return { name, file, spec }
}

/** Throws on unknown keys or bad shapes, so a typo can't silently run the default. */
export function validateVariant(spec) {
  const err = (m) => {
    throw new Error(`Variant spec: ${m}`)
  }
  if (!isObj(spec)) err('must be an object')
  for (const k of Object.keys(spec)) if (!TOP_KEYS.has(k)) err(`unknown key "${k}" (allowed: ${[...TOP_KEYS].join(', ')})`)
  for (const k of ['model', 'effort', 'description']) if (spec[k] != null && typeof spec[k] !== 'string') err(`"${k}" must be a string`)
  const sy = spec.sygnal
  if (sy != null && sy !== 'branch' && !(isObj(sy) && Object.keys(sy).length === 1 && (typeof sy.tarball === 'string' || typeof sy.npm === 'string'))) err('"sygnal" must be "branch", { "tarball": path } or { "npm": spec }')
  const sk = spec.skill
  if (sk != null && sk !== 'installed' && sk !== 'none') {
    if (!isObj(sk)) err('"skill" must be "installed", "none", { "dir" } or { "gitRef", "path" }')
    for (const k of Object.keys(sk)) if (!['dir', 'gitRef', 'path', 'name'].includes(k)) err(`unknown skill key "${k}"`)
    if (!!sk.dir === !!sk.gitRef) err('"skill" needs exactly one of "dir" or "gitRef"')
    if (sk.gitRef && typeof sk.path !== 'string') err('"skill.gitRef" needs "path"')
    if (sk.name != null && !/^[\w.-]+$/.test(sk.name)) err('"skill.name" must be a simple name')
  }
  if (spec.overlay != null) {
    if (!isObj(spec.overlay)) err('"overlay" must be an object keyed by all | sygnal | react')
    for (const [arm, ov] of Object.entries(spec.overlay)) {
      if (!ARM_KEYS.includes(arm)) err(`overlay key "${arm}" (use all, sygnal or react)`)
      if (!isObj(ov)) err(`overlay.${arm} must be an object`)
      for (const k of Object.keys(ov)) if (!OVERLAY_KEYS.has(k)) err(`unknown overlay.${arm} key "${k}" (allowed: ${[...OVERLAY_KEYS].join(', ')})`)
      for (const k of ['files', 'append']) {
        if (ov[k] == null) continue
        if (!isObj(ov[k])) err(`overlay.${arm}.${k} must map file paths to text`)
        for (const [rel, text] of Object.entries(ov[k])) {
          if (typeof text !== 'string') err(`overlay.${arm}.${k}["${rel}"] must be text`)
          safeRel(rel, err)
        }
      }
      if (ov.packageJson != null && !isObj(ov.packageJson)) err(`overlay.${arm}.packageJson must be an object`)
      if (ov.packs != null) {
        if (!isObj(ov.packs)) err(`overlay.${arm}.packs must be an object`)
        for (const [n, p] of Object.entries(ov.packs)) {
          if (!/^[\w.@/-]+$/.test(n) || !isObj(p) || typeof p.dir !== 'string') err(`overlay.${arm}.packs["${n}"] needs { "dir" }`)
          if (p.dependency != null && !['dependencies', 'devDependencies'].includes(p.dependency)) err(`overlay.${arm}.packs["${n}"].dependency must be dependencies or devDependencies`)
        }
      }
    }
  }
  if (spec.prompt != null) {
    if (!isObj(spec.prompt)) err('"prompt" must be an object')
    for (const k of Object.keys(spec.prompt)) if (!['prefix', 'suffix', 'arms'].includes(k)) err(`unknown prompt key "${k}"`)
    for (const k of ['prefix', 'suffix']) if (spec.prompt[k] != null && typeof spec.prompt[k] !== 'string') err(`prompt.${k} must be text`)
    checkArms(spec.prompt.arms, 'prompt.arms', err)
  }
  if (spec.mcp != null) {
    if (!isObj(spec.mcp) || !isObj(spec.mcp.mcpServers) || !Object.keys(spec.mcp.mcpServers).length) err('"mcp" needs { "mcpServers": { name: { command, args } } }')
    for (const k of Object.keys(spec.mcp)) if (!['arms', 'mcpServers'].includes(k)) err(`unknown mcp key "${k}"`)
    for (const n of Object.keys(spec.mcp.mcpServers)) if (!/^[\w-]+$/.test(n)) err(`MCP server name "${n}" must be [A-Za-z0-9_-]`)
    checkArms(spec.mcp.arms, 'mcp.arms', err)
  }
  return spec
}

function checkArms(arms, where, err) {
  if (arms == null) return
  if (!Array.isArray(arms) || !arms.length || arms.some((a) => !ARMS.includes(a))) err(`${where} must be a non-empty list of ${ARMS.join(', ')}`)
}

function safeRel(rel, err) {
  if (path.isAbsolute(rel) || rel.split(/[\\/]/).includes('..')) err(`overlay path "${rel}" must stay inside the starter`)
}

/** Resolve a spec path: ./ and ../ against the spec's dir, other relative paths against the repo root. */
export function resolveSpecPath(p, { repoRoot, specDir }) {
  if (path.isAbsolute(p)) return p
  return /^\.\.?[\\/]/.test(p) ? path.resolve(specDir, p) : path.resolve(repoRoot, p)
}

const sha = (x) => crypto.createHash('sha256').update(x).digest('hex')

/** Content hash of a directory tree (relative paths + file bytes), skipping node_modules and .git. */
export function hashDir(dir) {
  if (!fs.existsSync(dir)) throw new Error(`No such directory: ${dir}`)
  const h = crypto.createHash('sha256')
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      if (e.name === 'node_modules' || e.name === '.git') continue
      const p = path.join(d, e.name)
      if (e.isDirectory()) walk(p)
      else if (e.isFile()) {
        h.update(path.relative(dir, p).split(path.sep).join('/') + '\0')
        h.update(fs.readFileSync(p))
        h.update('\0')
      }
    }
  }
  walk(dir)
  return h.digest('hex')
}

/** JSON with sorted keys, for hashing. */
export function canonicalJson(x) {
  if (Array.isArray(x)) return `[${x.map(canonicalJson).join(',')}]`
  if (isObj(x)) return `{${Object.keys(x).sort().filter((k) => x[k] !== undefined).map((k) => `${JSON.stringify(k)}:${canonicalJson(x[k])}`).join(',')}}`
  return JSON.stringify(x ?? null)
}

function git(repoRoot, args, opts = {}) {
  const r = spawnSync('git', ['-C', repoRoot, ...args], { encoding: opts.encoding === null ? undefined : 'utf8', maxBuffer: 256 * 1024 * 1024 })
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${String(r.stderr).trim()}`)
  return r.stdout
}

/**
 * The variant with every input pinned: content hashes of the skill, overlay
 * dirs, packed dirs and given tarballs, plus the effective model and effort.
 * No side effects (reads files, runs `git rev-parse`). `hash` (12 hex chars)
 * identifies the variant in result records and the run manifest; paths are not
 * part of it, so it is the same on another machine.
 */
export function resolveVariant({ name, file, spec }, { repoRoot, model, effort }) {
  const specDir = file ? path.dirname(file) : repoRoot
  const P = (p) => resolveSpecPath(p, { repoRoot, specDir })
  const paths = {}
  // sygnal
  let sygnal = 'branch'
  if (isObj(spec.sygnal) && spec.sygnal.tarball) {
    paths.tarball = P(spec.sygnal.tarball)
    if (!fs.existsSync(paths.tarball)) throw new Error(`Variant ${name}: no tarball at ${paths.tarball}`)
    sygnal = { tarball: path.basename(paths.tarball), sha256: sha(fs.readFileSync(paths.tarball)) }
  } else if (isObj(spec.sygnal) && spec.sygnal.npm) sygnal = { npm: spec.sygnal.npm }
  // skill
  let skill = spec.skill ?? 'installed'
  if (isObj(spec.skill)) {
    const skillName = spec.skill.name ?? 'sygnal-dev'
    if (spec.skill.dir) {
      paths.skillDir = P(spec.skill.dir)
      if (!fs.existsSync(path.join(paths.skillDir, 'SKILL.md'))) throw new Error(`Variant ${name}: no SKILL.md in ${paths.skillDir}`)
      skill = { name: skillName, source: `dir:${spec.skill.dir}`, contentHash: hashDir(paths.skillDir) }
    } else {
      const tree = git(repoRoot, ['rev-parse', `${spec.skill.gitRef}:${spec.skill.path.replace(/\/$/, '')}`]).trim()
      git(repoRoot, ['cat-file', '-e', `${spec.skill.gitRef}:${spec.skill.path.replace(/\/$/, '')}/SKILL.md`])
      paths.skillGit = { ref: spec.skill.gitRef, path: spec.skill.path.replace(/\/$/, '') }
      skill = { name: skillName, source: `git:${spec.skill.gitRef}:${paths.skillGit.path}`, contentHash: `git-tree:${tree}` }
    }
  }
  // overlays
  const overlay = {}
  paths.overlay = {}
  for (const arm of ARM_KEYS) {
    const ov = spec.overlay?.[arm]
    if (!ov) continue
    const o = {}
    const po = (paths.overlay[arm] = {})
    if (ov.dir) {
      po.dir = P(ov.dir)
      o.dir = { source: ov.dir, contentHash: hashDir(po.dir) }
    }
    if (ov.files) o.files = ov.files
    if (ov.append) o.append = ov.append
    if (ov.packageJson) o.packageJson = ov.packageJson
    if (ov.packs) {
      o.packs = {}
      po.packs = {}
      for (const [n, p] of Object.entries(ov.packs)) {
        po.packs[n] = P(p.dir)
        o.packs[n] = { source: p.dir, dependency: p.dependency ?? 'devDependencies', contentHash: hashDir(po.packs[n]) }
      }
    }
    overlay[arm] = o
  }
  const prompt = spec.prompt ? { prefix: spec.prompt.prefix ?? '', suffix: spec.prompt.suffix ?? '', arms: spec.prompt.arms ?? ARMS } : null
  const mcp = spec.mcp ? { arms: spec.mcp.arms ?? ['sygnal'], mcpServers: spec.mcp.mcpServers } : null
  const resolved = { name, model: model ?? spec.model ?? null, effort: effort ?? spec.effort ?? null, sygnal, skill, overlay, prompt, mcp }
  return { ...resolved, hash: sha(canonicalJson(resolved)).slice(0, 12), file: file ?? null, paths }
}

/** One-line-per-part description of a resolved variant, for the dry run. */
export function describeVariant(v) {
  const lines = [`variant: ${v.name} (${v.hash})${v.file ? ` · ${v.file}` : ''}`]
  const sy = v.sygnal === 'branch' ? 'branch (pack this checkout)' : v.sygnal.npm ? `npm ${v.sygnal.npm}` : `tarball ${v.sygnal.tarball} (${v.sygnal.sha256.slice(0, 12)})`
  lines.push(`  sygnal: ${sy}`)
  const sk = v.skill === 'installed' ? 'installed (~/.claude/skills, not isolated)' : v.skill === 'none' ? 'none (user skills not loaded)' : `${v.skill.name} from ${v.skill.source} (${v.skill.contentHash.slice(0, 21)}), isolated per trial`
  lines.push(`  skill: ${sk}`)
  for (const [arm, o] of Object.entries(v.overlay)) lines.push(`  overlay.${arm}: ${Object.keys(o).map((k) => (k === 'files' || k === 'append' ? `${k}(${Object.keys(o[k]).join(',')})` : k === 'packs' ? `packs(${Object.keys(o.packs).join(',')})` : k)).join(' ')}`)
  if (v.prompt) lines.push(`  prompt (${v.prompt.arms.join(', ')}): ${v.prompt.prefix ? `prefix ${JSON.stringify(v.prompt.prefix)} ` : ''}${v.prompt.suffix ? `suffix ${JSON.stringify(v.prompt.suffix)}` : ''}`.trimEnd())
  if (v.mcp) lines.push(`  mcp (${v.mcp.arms.join(', ')}): ${Object.keys(v.mcp.mcpServers).join(', ')}`)
  if (v.model || v.effort) lines.push(`  model: ${v.model ?? 'default'} · effort: ${v.effort ?? 'default'}`)
  return lines.join('\n')
}

/**
 * Materialize a resolved variant under outDir (<trials-root>/<run>/_variant):
 * the skill copy, packed overlay packages, the MCP config, the npm tarball, and
 * prepare.json (what prepare.mjs applies per arm). Idempotent: reuses what is
 * there when the variant hash matches. Returns the paths the orchestrator needs.
 * @param {(outDir: string) => string} [o.npmPack]  npm pack of a spec or dir into outDir (tests stub it)
 */
export function materializeVariant(v, outDir, { repoRoot, npmPack = defaultNpmPack }) {
  const stampFile = path.join(outDir, 'variant.json')
  const fresh = !(fs.existsSync(stampFile) && JSON.parse(fs.readFileSync(stampFile, 'utf8')).hash === v.hash)
  if (fresh) fs.rmSync(outDir, { recursive: true, force: true })
  fs.mkdirSync(outDir, { recursive: true })
  const out = { dir: outDir, tarball: null, skillRoot: null, skillDir: null, mcpConfig: null, mcpAllow: [], prepareSpec: path.join(outDir, 'prepare.json') }
  // sygnal
  if (v.paths.tarball) out.tarball = v.paths.tarball
  else if (v.sygnal?.npm) out.tarball = cached(path.join(outDir, 'sygnal'), () => npmPack(v.sygnal.npm, path.join(outDir, 'sygnal')))
  // skill
  if (isObj(v.skill)) {
    out.skillRoot = path.join(outDir, 'skillroot')
    out.skillDir = path.join(out.skillRoot, '.claude', 'skills', v.skill.name)
    if (!fs.existsSync(path.join(out.skillDir, 'SKILL.md'))) {
      fs.rmSync(out.skillRoot, { recursive: true, force: true })
      fs.mkdirSync(out.skillDir, { recursive: true })
      if (v.paths.skillDir) fs.cpSync(v.paths.skillDir, out.skillDir, { recursive: true, filter: (p) => !['node_modules', '.git'].includes(path.basename(p)) })
      else extractGitTree(repoRoot, v.paths.skillGit.ref, v.paths.skillGit.path, out.skillDir)
    }
  }
  // packs + prepare spec
  const prepare = { variant: v.name, hash: v.hash, arms: {} }
  for (const arm of ARMS) {
    const parts = ['all', arm].filter((k) => v.overlay[k])
    const ov = { dirs: [], files: {}, append: {}, packageJson: null, vendor: [] }
    for (const k of parts) {
      const o = v.overlay[k]
      const po = v.paths.overlay[k] ?? {}
      if (po.dir) ov.dirs.push(po.dir)
      Object.assign(ov.files, o.files ?? {})
      for (const [rel, text] of Object.entries(o.append ?? {})) ov.append[rel] = (ov.append[rel] ?? '') + text
      if (o.packageJson) ov.packageJson = deepMerge(ov.packageJson ?? {}, o.packageJson)
      for (const [n, p] of Object.entries(o.packs ?? {})) {
        const dest = path.join(outDir, 'packs', n.replace(/[@/]/g, '_'))
        const tgz = cached(dest, () => npmPack(po.packs[n], dest))
        ov.vendor.push({ name: n, tarball: tgz, dependency: p.dependency })
      }
    }
    const prompt = v.prompt && v.prompt.arms.includes(arm) ? { prefix: v.prompt.prefix, suffix: v.prompt.suffix } : null
    prepare.arms[arm] = { overlay: parts.length ? ov : null, prompt }
  }
  fs.writeFileSync(out.prepareSpec, JSON.stringify(prepare, null, 2) + '\n')
  // mcp
  if (v.mcp) {
    out.mcpConfig = path.join(outDir, 'mcp.json')
    fs.writeFileSync(out.mcpConfig, JSON.stringify({ mcpServers: v.mcp.mcpServers }, null, 2) + '\n')
    out.mcpAllow = Object.keys(v.mcp.mcpServers).map((n) => `mcp__${n}`)
  }
  fs.writeFileSync(stampFile, JSON.stringify({ name: v.name, hash: v.hash, resolved: { ...v, paths: undefined } }, null, 2) + '\n')
  return out
}

/** What the CLI gets for one arm's trials (and the preflight): see the header. */
export function claudeIsolation(v, mat, arm) {
  if (!v) return {}
  const iso = {}
  if (v.skill !== 'installed') {
    iso.settingSources = ISOLATED_SETTING_SOURCES
    iso.addDirs = arm === 'sygnal' && mat?.skillRoot ? [mat.skillRoot] : []
  }
  if (v.mcp && v.mcp.arms.includes(arm) && mat?.mcpConfig) {
    iso.mcpConfig = mat.mcpConfig
    iso.extraAllowedTools = mat.mcpAllow
  }
  return iso
}

/** Skills a trial of this arm should (and should not) see, checked against the CLI's init event. */
export function expectedSkills(v, arm) {
  if (!v || v.skill === 'installed') return null
  const name = isObj(v.skill) ? v.skill.name : 'sygnal-dev'
  return arm === 'sygnal' && isObj(v.skill) ? { present: [name], absent: [] } : { present: [], absent: [name] }
}

/** Check an init skill list against expectedSkills(); returns a problem string or null. */
export function checkSkills(expected, skills) {
  if (!expected || !Array.isArray(skills)) return null
  const missing = expected.present.filter((s) => !skills.includes(s))
  const extra = expected.absent.filter((s) => skills.includes(s))
  if (missing.length) return `skill ${missing.join(', ')} not loaded`
  if (extra.length) return `skill ${extra.join(', ')} loaded but the variant has none`
  return null
}

// ---- overlay application (prepare.mjs)

/** Deep merge: objects merge, null deletes, anything else replaces. */
export function deepMerge(base, patch) {
  const out = isObj(base) ? { ...base } : {}
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) delete out[k]
    else if (isObj(v) && isObj(out[k])) out[k] = deepMerge(out[k], v)
    else out[k] = isObj(v) ? deepMerge({}, v) : v
  }
  return out
}

/** Apply one arm's resolved overlay (prepare.json arms[arm].overlay) to a fresh starter copy. */
export function applyOverlay(dest, ov) {
  if (!ov) return []
  const touched = []
  for (const d of ov.dirs ?? []) {
    fs.cpSync(d, dest, { recursive: true, filter: (p) => !['node_modules', '.git'].includes(path.basename(p)) })
    touched.push(`dir ${path.basename(d)}`)
  }
  for (const [rel, text] of Object.entries(ov.files ?? {})) {
    const p = path.join(dest, rel)
    fs.mkdirSync(path.dirname(p), { recursive: true })
    fs.writeFileSync(p, text)
    touched.push(rel)
  }
  for (const [rel, text] of Object.entries(ov.append ?? {})) {
    const p = path.join(dest, rel)
    fs.mkdirSync(path.dirname(p), { recursive: true })
    const old = fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : ''
    fs.writeFileSync(p, old + (old && !old.endsWith('\n') ? '\n' : '') + text)
    touched.push(`${rel} (+)`)
  }
  if (ov.packageJson || ov.vendor?.length) {
    const pj = path.join(dest, 'package.json')
    let pkg = JSON.parse(fs.readFileSync(pj, 'utf8'))
    if (ov.packageJson) pkg = deepMerge(pkg, ov.packageJson)
    for (const v of ov.vendor ?? []) {
      const rel = `vendor/${v.name.replace(/[@/]/g, '_')}.tgz`
      fs.mkdirSync(path.join(dest, 'vendor'), { recursive: true })
      fs.copyFileSync(v.tarball, path.join(dest, rel))
      pkg[v.dependency] = { ...(pkg[v.dependency] ?? {}), [v.name]: `file:${rel}` }
    }
    fs.writeFileSync(pj, JSON.stringify(pkg, null, 2) + '\n')
    touched.push('package.json')
  }
  return touched
}

/** The agent prompt with a variant's prefix/suffix (prepare.json arms[arm].prompt). */
export function applyPrompt(taskText, p) {
  if (!p) return taskText
  return `${p.prefix ? `${p.prefix.trim()}\n\n` : ''}${taskText}${p.suffix ? `\n\n${p.suffix.trim()}` : ''}`
}

// ---- helpers

function cached(dir, make) {
  const hit = fs.existsSync(dir) && fs.readdirSync(dir).find((f) => f.endsWith('.tgz'))
  if (hit) return path.join(dir, hit)
  fs.mkdirSync(dir, { recursive: true })
  return make()
}

function defaultNpmPack(specOrDir, outDir) {
  fs.mkdirSync(outDir, { recursive: true })
  const r = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['pack', specOrDir, '--json', '--pack-destination', outDir], { encoding: 'utf8', cwd: outDir })
  if (r.status !== 0) throw new Error(`npm pack ${specOrDir} failed: ${r.stderr.slice(-1500)}`)
  const info = JSON.parse(r.stdout.slice(r.stdout.indexOf('[')))
  return path.join(outDir, info[0].filename)
}

function extractGitTree(repoRoot, ref, treePath, dest) {
  const tar = spawnSync('git', ['-C', repoRoot, 'archive', '--format=tar', ref, treePath], { maxBuffer: 256 * 1024 * 1024 })
  if (tar.status !== 0) throw new Error(`git archive ${ref} ${treePath} failed: ${String(tar.stderr).trim()}`)
  const strip = treePath.split('/').filter(Boolean).length
  const x = spawnSync('tar', ['-x', '-C', dest, `--strip-components=${strip}`], { input: tar.stdout })
  if (x.status !== 0) throw new Error(`tar -x failed: ${String(x.stderr).trim()}`)
}
