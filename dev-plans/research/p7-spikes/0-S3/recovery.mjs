#!/usr/bin/env node
/**
 * PLAN-7 spike 0-S3 (throwaway): can completions get an AST of a buffer mid-edit?
 *
 *   node dev-plans/research/p7-spikes/0-S3/recovery.mjs <dir>... [--verbose]
 *
 * For every completion site the model knows in the given projects (intent keys, model keys,
 * DOM selector strings, next('X') / reply literals, <Collection from>, className strings), apply
 * the edits a user makes while typing there, then try three ways to get a usable AST at the cursor:
 *
 *   A  parse as is: @babel/parser with errorRecovery (what parseSource() already does)
 *   B  repair: if A throws, insert a closing suffix at the cursor ("'", "')", ": 0,", ...) and retry
 *   C  last good AST + the text before the cursor on its line (no parse; a regex classifier)
 *
 * "usable" (A, B): the parse succeeds, the component is still discovered with an intent and a model,
 * the intent/model still list at least as many actions as before minus one, and the cursor is
 * inside the component's intent function / model object / view (the context the completion needs).
 * "context" (C): the regex gives the same completion kind the site really is.
 *
 * Edits (cursor = where completion is asked):
 *   autoclosed   the string emptied with its quotes intact: DOM.click('|')         (editor auto-close on)
 *   unterminated the string cut at its middle, closing quote gone: DOM.click('.ad|  (auto-close off)
 *   key-typing   a new key being typed before a property, no colon: { NE|\n OLD: … }
 *   key-colon    a new key with a colon and no value: { NEW: |\n OLD: … }
 *   open-call    a new intent entry with an open call: { X: DOM.click('|\n OLD: … }
 *   truncate     everything after the cursor gone (worst case; typing at the end of a file)
 */
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const SRC = path.resolve(here, '../../../../sygnal-check/src')
const { Project, buildProject } = await import(path.join(SRC, 'model/project.js'))
const { expandInputs } = await import(path.join(SRC, 'files.js'))
const { parseSource, indexParents, unwrap, isFunction } = await import(path.join(SRC, 'ast.js'))
const { resolveExpr } = await import(path.join(SRC, 'model/resolve.js'))

const args = process.argv.slice(2)
const VERBOSE = args.includes('--verbose')
const dirs = args.filter(a => !a.startsWith('--'))
const cwd = process.cwd()

/** A Project that reads one file from memory (the throwaway form of the planned readFile overlay). */
class OverlayProject extends Project {
  constructor(overlay, opts) { super(opts); this.overlay = overlay }
  loadFile(absPath) {
    if (!this.overlay.has(absPath)) return super.loadFile(absPath)
    if (this.files.has(absPath)) return this.files.get(absPath)
    const source = this.overlay.get(absPath)
    let ast
    try { ast = parseSource(source, absPath) } catch (err) { this.files.set(absPath, null); this.lastError = err; return null }
    const file = { path: absPath, source, ast, parents: new WeakMap(), suppressions: new Map(), components: [] }
    indexParents(ast.program, file.parents)
    file.parents.set(ast.program, null)
    this.files.set(absPath, file)
    this._discoverComponents(file)
    return file
  }
}

const REPAIRS = ["'", '"', '`', "')", '")', "'),", "'}", '"}', '" />', '">', ': 0,', '0,', '0', ',', ')', '),', ': 0', ' }', '}']

/** Close what the text before the cursor left open: the string, then the brackets (naive: no JSX text, no regex literals). */
function closeAll(prefix) {
  const stack = []
  let q = null
  for (let i = 0; i < prefix.length; i++) {
    const ch = prefix[i]
    if (q) { if (ch === '\\') i++; else if (ch === q) q = null; continue }
    if (ch === '/' && prefix[i + 1] === '/') { const j = prefix.indexOf('\n', i); if (j < 0) break; i = j; continue }
    if (ch === '/' && prefix[i + 1] === '*') { const j = prefix.indexOf('*/', i + 2); if (j < 0) break; i = j + 1; continue }
    if (ch === "'" || ch === '"' || ch === '`') q = ch
    else if ('({['.includes(ch)) stack.push(ch)
    else if (')}]'.includes(ch)) stack.pop()
  }
  const close = { '(': ')', '{': '}', '[': ']' }
  let out = q || ''
  if (/[:,]\s*$/.test(prefix + out) && !q) out += '0'
  return out + stack.reverse().map(c => close[c]).join('')
}

// completion kind from the text before the cursor on its line (approach C)
function classify(prefix) {
  if (/\bnext\(\s*['"`][^'"`]*$/.test(prefix)) return 'action-string'
  if (/\b(ok|error|delta|tool|block|action|frame)\s*:\s*['"`][^'"`]*$/.test(prefix)) return 'action-string'
  if (/\.select\(\s*['"`][^'"`]*$/.test(prefix) && /EVENTS/.test(prefix)) return 'event-string'
  if (/\b(DOM|DOM\.select\([^)]*\))\.\w+\(\s*['"`][^'"`]*$/.test(prefix) || /\bselect\(\s*['"`][^'"`]*$/.test(prefix)) return 'selector-string'
  if (/\bfrom=["'][^"']*$/.test(prefix) || /\bfrom=\{\s*['"`][^'"`]*$/.test(prefix)) return 'state-key-string'
  if (/\bclass(Name)?=["'][^"']*$/.test(prefix) || /\bclass(Name)?=\{[^}]*['"`][^'"`]*$/.test(prefix)) return 'class-string'
  if (/(^|[{,])\s*['"]?[A-Za-z_$][\w$.]*['"]?\s*$/.test(prefix) || /(^|[{,])\s*$/.test(prefix)) return 'object-key'
  if (/(^|[{,])\s*['"]?[A-Za-z_$][\w$.]*['"]?\s*:\s*$/.test(prefix)) return 'object-value'
  return 'other'
}

function sitesOf(project) {
  const sites = []
  for (const c of project.components) {
    if (!c.intent?.fn || !c.model?.entries.length) continue
    const push = (kind, file, node, ops, expect) => { if (node && file && file === c.file) sites.push({ comp: c.name, file: file.path, node: { start: node.start, end: node.end, type: node.type }, kind, ops, expect }) }
    for (const a of c.intent.actions) push('intent-key', c.intent.file, a.node, ['key-typing', 'key-colon', 'open-call', 'truncate'], 'object-key')
    for (const e of c.model.entries) if (e.node.type !== 'Identifier' || e.node.name !== 'undoable') push('model-key', e.file, e.node, ['key-typing', 'key-colon', 'truncate'], 'object-key')
    for (const s of c.intent.selectors) if (s.node.type === 'StringLiteral') push('selector', c.intent.file, s.node, ['autoclosed', 'unterminated', 'truncate'], 'selector-string')
    for (const t of c.model.nextTargets) push('next', t.file, t.node, ['autoclosed', 'unterminated', 'truncate'], 'action-string')
    for (const t of c.model.replyTargets) if (t.node.type === 'StringLiteral') push('reply', t.file, t.node, ['autoclosed', 'unterminated', 'truncate'], 'action-string')
    for (const col of c.viewInfo?.collections || []) {
      const v = col.fromNode?.value
      if (v?.type === 'StringLiteral') push('collection-from', c.file, v, ['autoclosed', 'unterminated', 'truncate'], 'state-key-string')
    }
    for (const el of c.viewInfo?.elements || []) {
      const a = el.node.openingElement.attributes.find(x => x.type === 'JSXAttribute' && x.name.name === 'className' && x.value?.type === 'StringLiteral')
      if (a && el.file === c.file) push('className', c.file, a.value, ['autoclosed', 'unterminated', 'truncate'], 'class-string')
    }
  }
  return sites
}

function applyEdit(src, site, op) {
  const { start, end } = site.node
  const lineStart = src.lastIndexOf('\n', start - 1) + 1
  const indent = src.slice(lineStart, start).match(/^\s*/)[0]
  switch (op) {
    case 'autoclosed': return { text: src.slice(0, start + 1) + src.slice(end - 1), cursor: start + 1 }
    case 'unterminated': {
      const mid = start + 1 + Math.floor((end - start - 2) / 2)
      return { text: src.slice(0, mid) + src.slice(end), cursor: mid }
    }
    case 'key-typing': { const ins = 'NE'; return { text: src.slice(0, start) + ins + '\n' + indent + src.slice(start), cursor: start + ins.length } }
    case 'key-colon': { const ins = 'NEW: '; return { text: src.slice(0, start) + ins + '\n' + indent + src.slice(start), cursor: start + ins.length } }
    case 'open-call': { const ins = "X: DOM.click('"; return { text: src.slice(0, start) + ins + '\n' + indent + src.slice(start), cursor: start + ins.length } }
    case 'truncate': {
      const cur = site.node.type === 'StringLiteral' ? start + 1 : end
      return { text: src.slice(0, cur), cursor: cur }
    }
  }
}

const contains = (n, off) => !!n && n.start <= off && off <= n.end

function usable(file, text, site, cursor, base) {
  const overlay = new Map([[file, text]])
  const p = new OverlayProject(overlay, { cwd })
  const f = p.loadFile(file)
  if (!f) return { ok: false, why: p.lastError?.reasonCode || 'parse' }
  const c = f.components.find(x => x.name === site.comp)
  if (!c) return { ok: false, why: 'component lost' }
  p._analyzeComponent(c)
  if (!c.intent?.fn || !c.model) return { ok: false, why: 'statics lost' }
  if (c.intent.actions.length < base.intent - 1 || c.model.entries.length < base.model - 1) return { ok: false, why: 'actions lost' }
  const m = resolveExpr(p, f, c.staticProps.model)?.node
  const where = [c.intent.fn, m, c.view].filter(Boolean)
  if (!where.some(n => n.start <= cursor && cursor <= n.end)) return { ok: false, why: 'cursor outside' }
  return { ok: true }
}

const results = []
for (const dir of dirs) {
  const { files } = expandInputs([path.resolve(dir)], { cwd })
  const project = buildProject(files, { cwd })
  const sites = sitesOf(project)
  for (const site of sites) {
    const src = fs.readFileSync(site.file, 'utf8')
    const comp = project.components.find(c => c.name === site.comp && c.file.path === site.file)
    const base = { intent: comp.intent.actions.length, model: comp.model.entries.length }
    for (const op of site.ops) {
      const { text, cursor } = applyEdit(src, site, op)
      const a = usable(site.file, text, site, cursor, base)
      let b = a, repair = null
      if (!a.ok && (a.why === 'parse' || /Unterminated|Unexpected|Missing|Expected/.test(a.why))) {
        for (const r of [...REPAIRS, closeAll(text.slice(0, cursor))]) {
          const t2 = text.slice(0, cursor) + r + text.slice(cursor)
          const res = usable(site.file, t2, site, cursor, base)
          if (res.ok) { b = res; repair = r; break }
        }
      }
      const prefix = text.slice(text.lastIndexOf('\n', cursor - 1) + 1, cursor)
      const kind = classify(prefix)
      const expect = op === 'key-colon' ? 'object-value' : op === 'open-call' ? 'selector-string' : site.expect
      results.push({ dir, site: site.kind, op, a: a.ok, aWhy: a.why, b: b.ok, bWhy: b.why, repair, c: kind === expect, kind, expect, prefix })
    }
  }
}

// --- report ---
const pct = (n, d) => d ? `${Math.round(100 * n / d)}%` : '-'
const group = (key) => {
  const m = new Map()
  for (const r of results) { const k = key(r); if (!m.has(k)) m.set(k, []); m.get(k).push(r) }
  return m
}
console.log(`# ${results.length} edits over ${dirs.join(', ')}`)
console.log('\n| edit | n | A: errorRecovery parse usable | B: + repair suffix | C: line-prefix context |')
console.log('|---|---|---|---|---|')
for (const [op, rs] of group(r => r.op)) {
  console.log(`| ${op} | ${rs.length} | ${pct(rs.filter(r => r.a).length, rs.length)} | ${pct(rs.filter(r => r.b).length, rs.length)} | ${pct(rs.filter(r => r.c).length, rs.length)} |`)
}
const all = results
console.log(`| **all** | ${all.length} | ${pct(all.filter(r => r.a).length, all.length)} | ${pct(all.filter(r => r.b).length, all.length)} | ${pct(all.filter(r => r.c).length, all.length)} |`)
console.log('\n| site | n | A | B | C |')
console.log('|---|---|---|---|---|')
for (const [s, rs] of group(r => r.site)) {
  console.log(`| ${s} | ${rs.length} | ${pct(rs.filter(r => r.a).length, rs.length)} | ${pct(rs.filter(r => r.b).length, rs.length)} | ${pct(rs.filter(r => r.c).length, rs.length)} |`)
}
const why = {}
for (const r of results) if (!r.a) why[r.aWhy] = (why[r.aWhy] || 0) + 1
console.log('\nA failures by reason: ' + JSON.stringify(why))
const whyB = {}
for (const r of results) if (!r.b) whyB[`${r.op}:${r.bWhy}`] = (whyB[`${r.op}:${r.bWhy}`] || 0) + 1
console.log('B failures by edit:reason: ' + JSON.stringify(whyB))
const rep = {}
for (const r of results) if (r.repair) rep[r.repair] = (rep[r.repair] || 0) + 1
console.log('Repair suffixes that worked: ' + JSON.stringify(rep))
if (VERBOSE) for (const r of results.filter(r => !r.c)) console.log(`C miss: ${r.site}/${r.op}: expected ${r.expect}, got ${r.kind}: ${JSON.stringify(r.prefix)}`)
