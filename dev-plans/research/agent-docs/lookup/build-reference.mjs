#!/usr/bin/env node
// The agent reference (dev-plans/research/agent-docs): one answer per symbol, generated from the
// package's types (dist/index.d.ts and every subpath's declarations), the agent context
// (llms.txt, llms/<topic>.md) and sygnal-check's explanations. Written next to the guides by
// `npm run build`, so both forms ship in the package and need no network:
//   dist/reference.json   what `sygnal-check docs <symbol>` and its MCP tool answer from
//   dist/reference.md     the same answers under one `## <symbol>` heading each, for grep
// `--check` writes nothing and exits 1 when they are stale. `--context <dir>` reads llms.txt and
// llms/ from another directory, `--out <dir>` writes elsewhere (the eval candidates).
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const ts = createRequire(import.meta.url)('typescript')

export const ANSWER_BUDGET = 1800  // bytes of one answer; the options list gives way first
const MAX_OWNERS = 8
const DOC_LINE = 110
const TYPE_LINE = 64

// The sink a driver's name stands for → the request type its model entries return. Everything
// else on the entry is generated; test/reference.test.js fails when a target stops existing.
export const SINK_REQUESTS = { HTTP: 'FetchRequest', WS: 'SocketRequest', LLM: 'ChatRequest', ROUTER: 'RouterCommand' }

// JSDoc carries planning references the reader has no use for: "PLAN-11 (6.7): ", "RT-1: ", "(D229, SYG612)".
const clean = (s) => s
  .replace(/\s*\(PLAN-[^)]*\)/g, '')
  .replace(/(^|[.;:]\s+)(?:PLAN-[\d.]+(?: [A-Z\d]+-?\d*)?(?: \([\d.]+\))?|\d+\.\d+(?: timing audit)?|[A-Z]{1,3}-\d+[a-z]?(?: \([\d.]+\))?|D\d+):\s*/g, '$1')
  .replace(/\bPLAN-[\d.]+(?: [A-Z\d]+-?\d*)?:?\s*/g, '')
  .replace(/\s*\((?:[GD]-?\d+(?:[,/ ]+[GD]-?\d+)*)\)/g, '')
  .replace(/\(([GD]-?\d+,\s*)+/g, '(')
  .replace(/\s+/g, ' ').trim()

function firstSentences(text, max) {
  const t = clean(text)
  if (t.length <= max) return t
  const cut = t.slice(0, max)
  const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('; '))
  return end > max / 3 ? cut.slice(0, end + 1) : cut.slice(0, max - 1).trimEnd() + '…'
}
const squeeze = (s, max) => { const t = s.replace(/\s+/g, ' ').trim(); return t.length <= max ? t : t.slice(0, max - 1).trimEnd() + '…' }
const bytes = (s) => Buffer.byteLength(s)
const wordIn = (name) => new RegExp(`(?<![\\w$.-])${name.replace(/[$]/g, '\\$')}(?![\\w$-])`)

/** Each subpath the package exports with its declaration file. */
function entryPoints() {
  const pkg = JSON.parse(fs.readFileSync(path.join(repo, 'package.json'), 'utf8'))
  const out = []
  for (const [sub, v] of Object.entries(pkg.exports)) {
    const types = typeof v === 'object' ? (v.types ?? v.import?.types) : null
    if (types && types.endsWith('.d.ts') && fs.existsSync(path.join(repo, types))) out.push({ module: sub === '.' ? 'sygnal' : `sygnal/${sub.slice(2)}`, file: path.join(repo, types) })
  }
  return { version: pkg.version, entries: out }
}

function createProgram(files) {
  return ts.createProgram(files, {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler,
    jsx: ts.JsxEmit.Preserve, strict: false, skipLibCheck: true, noEmit: true, baseUrl: repo,
    paths: { sygnal: ['dist/index.d.ts'], 'sygnal/host': ['src/host.d.ts'], 'sygnal/*': ['src/*.d.ts'] },
  })
}

const PRINT = ts.TypeFormatFlags.NoTruncation | ts.TypeFormatFlags.UseAliasDefinedOutsideCurrentScope

function isOwn(sym) {
  return (sym.declarations ?? []).some((d) => { const f = d.getSourceFile().fileName; return f.startsWith(repo) && !f.includes('/node_modules/') })
}

/** Readable documented properties of a type, unions flattened. */
function propertiesOf(checker, type) {
  if (!type) return []
  const parts = type.isUnion() ? type.types : [type]
  const seen = new Map()
  for (const t of parts) {
    if (t.flags & (ts.TypeFlags.Primitive | ts.TypeFlags.Never)) continue
    for (const p of checker.getPropertiesOfType(t)) if (!seen.has(p.name) && isOwn(p) && !p.name.startsWith('__')) seen.set(p.name, p)
  }
  return [...seen.values()]
}

function memberOf(checker, p, at) {
  const type = checker.getTypeOfSymbolAtLocation(p, at)
  const optional = !!(p.flags & ts.SymbolFlags.Optional)
  const doc = clean(ts.displayPartsToString(p.getDocumentationComment(checker)))
  const sig = type.getCallSignatures()
  const text = checker.typeToString(type, at, PRINT)
  return { name: p.name, optional, type: text, callable: sig.length > 0, doc }
}

/** The object parameter a function takes its options in, if any. */
function optionsParam(checker, sig, at) {
  for (let i = sig.parameters.length - 1; i >= 0; i--) {
    const p = sig.parameters[i]
    const type = checker.getTypeOfSymbolAtLocation(p, at)
    if (type.getCallSignatures().length) continue
    const props = propertiesOf(checker, checker.getApparentType(type))
    if (props.length) return { param: p.name, type, props }
  }
  return null
}

function declaredKind(sym) {
  const f = sym.flags
  if (f & ts.SymbolFlags.Function) return 'function'
  if (f & ts.SymbolFlags.Class) return 'class'
  if (f & ts.SymbolFlags.Variable) return 'const'
  if (f & ts.SymbolFlags.Interface) return 'interface'
  if (f & ts.SymbolFlags.TypeAlias) return 'type'
  return 'value'
}

/** Code lines and inline code spans of the agent context, each with where it came from. */
function readContext(contextDir) {
  const docs = []
  const add = (rel, file) => docs.push({ rel, text: fs.readFileSync(file, 'utf8') })
  add('llms.txt', path.join(contextDir, 'llms.txt'))
  const dir = path.join(contextDir, 'llms')
  for (const f of fs.readdirSync(dir).sort()) if (f.endsWith('.md')) add(`llms/${f}`, path.join(dir, f))
  const code = []
  for (const d of docs) {
    let fenced = false
    for (const line of d.text.split('\n')) {
      if (line.startsWith('```')) { fenced = !fenced; continue }
      if (fenced) { const c = line.trim(); if (c && !c.startsWith('//')) code.push({ rel: d.rel, code: c, fenced: true }); continue }
      for (const m of line.matchAll(/(?<=^|[^`])`([^`\n]+)`/g)) {
        if (/\b(?:not|never|don't|avoid|instead of|no)\s*$/i.test(line.slice(Math.max(0, m.index - 16), m.index))) continue
        code.push({ rel: d.rel, code: m[1], fenced: false })
      }
    }
  }
  return { docs, code }
}

function readGuides() {
  const root = path.join(repo, 'dist/guide')
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : e.name.endsWith('.md') ? [path.join(dir, e.name)] : []))
  return fs.existsSync(root) ? walk(root).sort().map((f) => ({ rel: path.relative(repo, f).split(path.sep).join('/'), text: fs.readFileSync(f, 'utf8') })) : []
}

function makeContextIndex({ docs, code }, guides) {
  const memo = new Map()
  const mentions = (name) => {
    const re = new RegExp(wordIn(name).source, 'g')
    return [...docs, ...guides].reduce((sum, d) => sum + (d.text.match(re) ?? []).length, 0)
  }
  const topicFor = (name) => {
    if (memo.has(name)) return memo.get(name)
    const re = new RegExp(wordIn(name).source, 'g')
    let best = null, bestScore = 0
    for (const d of [...docs, ...guides]) {
      const n = (d.text.match(re) ?? []).length
      if (!n) continue
      const score = d.rel === 'llms.txt' ? n * 0.6 : d.rel.startsWith('dist/') ? n / 20 : n
      if (score > bestScore) { best = d.rel; bestScore = score }
    }
    memo.set(name, best)
    return best
  }
  // A usage or nothing: a span that merely names the symbol teaches less than no example.
  const exampleFor = (name, owner, kind, prefer) => {
    const n = name.replace(/[$]/g, '\\$')
    const usage = kind === 'jsx' ? new RegExp(`<${n}\\s+\\w+=|<${n}\\s*/>`)
      : kind === 'call' ? new RegExp(`(?<![\\w$.])${n}\\s*[(<]`)
      : kind === 'static' ? new RegExp(`\\.${n}\\s*=`)
      : kind === 'source' ? new RegExp(`(?<![\\w$.])${n}\\.\\w+\\(`)
      : kind === 'sink' ? new RegExp(`(?<![\\w$.])${n}:\\s*\\S`)
      : new RegExp(`(?<![\\w$.])${n}\\s*[:=]\\s*\\S|\\.${n}\\(|<\\w+ [^>]*\\b${n}=`)
    let best = null, bestScore = Infinity
    for (const c of code) {
      if (c.code.length < name.length + 3 || c.code.length > 170 || !usage.test(c.code)) continue
      let score = c.code.length
      if (owner && !c.code.includes(owner)) score += 10
      if (prefer && c.code.includes(prefer)) score -= 60
      if (c.rel === 'llms.txt') score -= 15
      if (c.code.endsWith(',') || /^[})\]]/.test(c.code)) score += 40
      const open = (c.code.match(/[({[]/g) ?? []).length, close = (c.code.match(/[)}\]]/g) ?? []).length
      if (open !== close) score += 100
      if (score < bestScore) { best = c.code; bestScore = score }
    }
    return best
  }
  return { topicFor, exampleFor, mentions }
}

const readLine = (rel) => (rel ? `Read: node_modules/sygnal/${rel}` : null)

const optionLine = (o) => `${o.name}${o.optional ? '?' : ''}: ${squeeze(o.type, TYPE_LINE)}${o.doc ? ` - ${firstSentences(o.doc, DOC_LINE)}` : ''}`

/** As many option lines as fit in `room` bytes; the names of the rest on one line. */
function fitOptions(options, room) {
  const out = []
  let used = 0, i = 0
  for (; i < options.length; i++) {
    const l = optionLine(options[i])
    if (used + bytes(l) + 3 > room) break
    out.push(l); used += bytes(l) + 3
  }
  if (i < options.length) {
    const names = options.slice(i).map((o) => o.name)
    const left = room - used - 3
    let rest = `also: ${names.join(', ')}`
    if (bytes(rest) > left) {
      while (names.length && bytes(`also: ${names.join(', ')}, …`) > left) names.pop()
      rest = names.length ? `also: ${names.join(', ')}, …` : '…'
    }
    out.push(rest)
  }
  return out
}

/** One answer's parts, its options fitted to the budget. */
function finish(e) {
  const fixed = [e.title, e.summary, e.signature, e.example && `Example: ${e.example}`, e.note, e.topic && `Read: node_modules/sygnal/${e.topic}`, e.options?.length && `${e.optionsLabel}:`].filter(Boolean).join('\n')
  return {
    kind: e.kind, ...(e.module ? { module: e.module } : {}), title: e.title, summary: e.summary ?? null, signature: e.signature ?? null,
    label: e.options?.length ? e.optionsLabel : null, options: e.options?.length ? fitOptions(e.options, ANSWER_BUDGET - bytes(fixed) - 2) : [],
    example: e.example ?? null, note: e.note ?? null, topic: e.topic ?? null,
  }
}

/** One answer's text: the same bytes in the CLI, the MCP tool and the reference file. */
export function textOf(e) {
  return [
    e.title, e.summary, e.signature, e.label && `${e.label}:`, ...e.options.map((o) => `  ${o}`),
    e.example && `Example: ${e.example}`, e.note, e.topic && `Read: node_modules/sygnal/${e.topic}`,
  ].filter(Boolean).join('\n')
}

function generate({ contextDir }) {
  const { version, entries: points } = entryPoints()
  const program = createProgram(points.map((p) => p.file))
  const checker = program.getTypeChecker()
  const ctx = makeContextIndex(readContext(contextDir), readGuides())
  const entries = new Map()
  const owners = new Map()   // member name → [Owner.member keys]
  const memberInfo = new Map()
  const exportsByModule = new Map()

  const addMembers = (owner, members, ownerModule) => {
    for (const m of members) {
      const key = `${owner}.${m.name}`
      if (entries.has(key)) continue
      if (!owners.has(m.name)) owners.set(m.name, [])
      owners.get(m.name).push(key)
      memberInfo.set(key, m)
      if (!m.doc && owner !== 'Component') continue   // the owner's list has it; an entry would only repeat that line
      entries.set(key, {
        key, kind: 'member', owner, name: m.name, module: ownerModule,
        title: `${key}${m.optional ? '?' : ''}: ${squeeze(m.type, 240)}`,
        summary: firstSentences(m.doc, 700) || null,
        example: ctx.exampleFor(m.name, owner, owner === 'Component' ? 'static' : m.callable ? 'call' : undefined), topic: ctx.topicFor(owner) ?? ctx.topicFor(m.name),
      })
    }
  }

  for (const point of points) {
    const source = program.getSourceFile(point.file)
    const mod = source && checker.getSymbolAtLocation(source)
    if (!mod) continue
    const names = []
    for (const exported of checker.getExportsOfModule(mod)) {
      const name = exported.name
      if (name === 'default' || name.startsWith('__')) continue
      names.push(name)
      const sym = exported.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(exported) : exported
      if (!isOwn(sym) || entries.has(name)) continue
      const at = sym.declarations?.[0]
      if (!at) continue
      const kind = declaredKind(sym)
      let signature = null, members = [], label = 'Options'
      if (kind === 'function' || kind === 'const' || kind === 'class') {
        const type = checker.getTypeOfSymbolAtLocation(sym, at)
        const sigs = type.getCallSignatures()
        if (sigs.length) {
          signature = sigs.slice(0, 2).map((s) => `${name}${squeeze(checker.signatureToString(s, at, ts.TypeFormatFlags.NoTruncation), 300)}`).join('\n')
          const opt = optionsParam(checker, sigs[0], at)
          if (opt) { members = opt.props.map((p) => memberOf(checker, p, at)); label = `Options (${opt.param})` }
        } else {
          signature = `${name}: ${squeeze(checker.typeToString(type, at, PRINT), 300)}`
          const props = propertiesOf(checker, type)
          if (props.length && kind !== 'class') { members = props.map((p) => memberOf(checker, p, at)); label = 'Members' }
        }
        if (kind === 'class') {
          const inst = checker.getDeclaredTypeOfSymbol(sym)
          members = propertiesOf(checker, inst).map((p) => memberOf(checker, p, at)); label = 'Members'
        }
      } else {
        const type = checker.getDeclaredTypeOfSymbol(sym)
        signature = squeeze(at.getText().replace(/\/\*\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '').split('{')[0], 200).replace(/\s*[|=]$/, '')
        members = propertiesOf(checker, type).map((p) => memberOf(checker, p, at)); label = 'Members'
      }
      members = members.filter((m) => m.type !== 'never')
      if (members.length > 400) members = []
      entries.set(name, {
        key: name, kind, module: point.module,
        title: `${name} (${kind}, ${point.module})`,
        summary: firstSentences(ts.displayPartsToString(sym.getDocumentationComment(checker)), 360) || null,
        signature, options: members.map(({ name: n, optional, type, doc }) => ({ name: n, optional, type, doc })), optionsLabel: label,
        example: ctx.exampleFor(name, undefined, /^[A-Z]/.test(name) && kind !== 'type' && kind !== 'interface' ? 'jsx' : kind === 'function' || kind === 'const' ? 'call' : undefined, members[0] && `${members[0].name}=`) ?? (kind === 'const' || kind === 'function' ? ctx.exampleFor(name, undefined, 'call') : null),
        topic: ctx.topicFor(name),
      })
      addMembers(name, members, point.module)
    }
    exportsByModule.set(point.module, names)
  }

  // Statics of a component: `Component.drivers`, reachable as `.drivers`, `App.drivers`.
  const staticsOwner = entries.get('Component')
  if (staticsOwner) for (const o of staticsOwner.options) { const e = entries.get(`Component.${o.name}`); if (e) e.kind = 'static' }

  // Sources and sinks by name.
  // What DOM.<event>(selector) returns: `.value()`, `.checked()`, `.key()`, `.data(name)`, read from the type.
  const dts = program.getSourceFile(path.join(repo, 'dist/index.d.ts'))
  const streamHelpers = () => {
    const decl = dts?.statements.find((s) => ts.isInterfaceDeclaration(s) && s.name.text === 'EnrichedEventStream')
    if (!decl) return []
    const seen = new Set()
    return decl.members.filter((m) => ts.isMethodSignature(m) && !seen.has(m.name.getText()) && seen.add(m.name.getText()))
      .map((m) => ({ name: m.name.getText(), optional: false, type: m.getText().replace(/\/\*\*[\s\S]*?\*\//g, '').trim().replace(/;$/, ''), callable: true, doc: clean(ts.getJSDocCommentsAndTags(m).map((j) => (typeof j.comment === 'string' ? j.comment : '')).join(' ')) || 'On the stream DOM.<event>(selector) returns.' }))
  }
  const defaultDrivers = program.getSourceFile(path.join(repo, 'dist/index.d.ts'))?.statements.find((s) => ts.isTypeAliasDeclaration(s) && s.name.text === 'DefaultDrivers')
  if (defaultDrivers) {
    const type = checker.getTypeAtLocation(defaultDrivers)
    for (const p of checker.getPropertiesOfType(type)) {
      const spec = checker.getTypeOfSymbolAtLocation(p, defaultDrivers)
      const sourceSym = spec.getProperty('source')
      const source = sourceSym && checker.getTypeOfSymbolAtLocation(sourceSym, defaultDrivers)
      if (!source || source.flags & ts.TypeFlags.Never) continue
      const members = propertiesOf(checker, source).filter((m) => !/^(_|isolate|namespace$|dispose$)/.test(m.name))
      let documented = members.map((m) => memberOf(checker, m, defaultDrivers)).sort((a, b) => Number(!!b.doc) - Number(!!a.doc))
      if (p.name === 'DOM') { const helpers = streamHelpers(); addMembers('EventStream', helpers, 'sygnal'); documented = [...documented, ...helpers] }
      addMembers(p.name, documented, 'sygnal')
      entries.set(p.name, {
        key: p.name, kind: 'source', module: 'sygnal', title: `${p.name} (source, in intent)`,
        options: documented.map(({ name, optional, type: t, doc }) => ({ name, optional, type: t, doc })), optionsLabel: 'Members',
        example: ctx.exampleFor(p.name, undefined, 'source'), topic: ctx.topicFor(p.name),
        note: p.name === 'DOM' ? 'DOM.<event>(selector) exists for every HTML event: DOM.click, DOM.input, DOM.keydown.' : null,
      })
    }
  }
  const { docs } = readContext(contextDir)
  const drivers = new Map()
  for (const d of docs) for (const m of d.text.matchAll(/\b([A-Z][A-Z_]+): *(make[A-Za-z]+Driver|router\.driver)\b/g)) if (!drivers.has(m[1])) drivers.set(m[1], m[2])
  for (const [sink, factory] of [...drivers].sort()) {
    if (entries.has(sink)) continue
    const req = SINK_REQUESTS[sink] && entries.get(SINK_REQUESTS[sink])
    entries.set(sink, {
      key: sink, kind: 'sink', module: 'sygnal', title: `${sink} (driver sink and source, from ${factory})`,
      summary: req?.summary ?? entries.get(factory)?.summary ?? null,
      options: req?.options ?? entries.get(factory)?.options ?? [], optionsLabel: req ? `Request (${req.key})` : 'Options',
      example: ctx.exampleFor(sink, undefined, 'sink'), topic: ctx.topicFor(sink) ?? ctx.topicFor(factory),
    })
  }
  // Built-in model sinks.
  const modelEntry = program.getSourceFile(path.join(repo, 'dist/index.d.ts'))?.statements.find((s) => ts.isTypeAliasDeclaration(s) && ts.isTypeLiteralNode(s.type) && s.type.members.some((m) => m.name?.getText() === 'EFFECT'))
  if (modelEntry) for (const m of modelEntry.type.members) {
    const sink = m.name?.getText()
    if (!sink || entries.has(sink)) continue
    const doc = ts.getJSDocCommentsAndTags(m).map((j) => (typeof j.comment === 'string' ? j.comment : '')).join(' ')
    entries.set(sink, { key: sink, kind: 'sink', module: 'sygnal', title: `${sink} (model sink)`, summary: firstSentences(doc, 300) || null, signature: squeeze(m.getText().replace(/\/\*\*[\s\S]*?\*\//g, ''), 200), example: ctx.exampleFor(sink, undefined, 'sink'), topic: ctx.topicFor(sink) })
  }

  // Subpaths.
  for (const [mod, names] of exportsByModule) {
    if (mod === 'sygnal') continue
    entries.set(mod, {
      key: mod, kind: 'subpath', module: mod, title: `${mod} (import)`, topic: ctx.topicFor(mod),
      summary: names.length ? squeeze(`Exports: ${names.join(', ')}`, 1200) : null,
    })
  }

  // Members that say the same thing under several owners (FetchRequest.latest, ResourceRequest.latest)
  // keep one entry, under the owner the context mentions most; the other keys alias to it.
  const aliases = {}
  // A type's name is the stable one; a function's options repeat the type they take.
  const rank = (key) => [/^[a-z]/.test(key) ? 1 : 0, -ctx.mentions(key.split('.')[0]), key.length, key]
  const byRank = (a, b) => { const x = rank(a), y = rank(b); return x[0] - y[0] || x[1] - y[1] || x[2] - y[2] || (x[3] < y[3] ? -1 : 1) }
  const same = new Map()
  for (const [key, m] of memberInfo) if (entries.has(key)) { const k = `${m.name}\0${m.type}\0${m.doc}`; (same.get(k) ?? same.set(k, []).get(k)).push(key) }
  for (const keys of same.values()) {
    const [keep, ...rest] = keys.sort(byRank)
    for (const k of rest) { aliases[k] = keep; entries.delete(k) }
  }
  // A member name on its own: one meaning aliases to it, several get a list.
  for (const [name, keys] of owners) {
    if (entries.has(name)) continue
    const groups = new Map()
    for (const k of keys) { const m = memberInfo.get(k); const g = `${m.type}\0${m.doc}`; (groups.get(g) ?? groups.set(g, []).get(g)).push(k) }
    if (groups.size === 1) { const best = [...keys].sort(byRank)[0]; const target = aliases[best] ?? best; if (entries.has(target)) aliases[name] = target; continue }
    const lines = [...groups.values()].map((g) => g.sort(byRank)).sort((a, b) => byRank(a[0], b[0]))
    const shown = lines.slice(0, MAX_OWNERS)
    entries.set(name, {
      key: name, kind: 'member-index', title: `${name} (a member of ${keys.length} types)`,
      options: shown.map((g) => { const m = memberInfo.get(g[0]); return { name: g.slice(0, 3).join(', ') + (g.length > 3 ? ', …' : ''), optional: m.optional, type: m.type, doc: m.doc } }), optionsLabel: 'Where',
      note: lines.length > shown.length ? `${lines.length - shown.length} more meanings not shown.` : null,
      example: ctx.exampleFor(name), topic: ctx.topicFor(name),
    })
  }
  for (const ev of checker.getPropertiesOfType(checker.getDeclaredTypeOfSymbol(checker.resolveName('HTMLElementEventMap', dts, ts.SymbolFlags.Type, false)))) aliases[`DOM.${ev.name}`] = 'DOM'

  // Diagnostics, from the checker's explanations.
  const explanations = JSON.parse(fs.readFileSync(path.join(repo, 'sygnal-check/explanations.json'), 'utf8'))
  for (const e of Array.isArray(explanations) ? explanations : Object.values(explanations)) {
    entries.set(e.code, {
      key: e.code, kind: 'diagnostic', title: `${e.code} (${e.severity}): ${e.title}`,
      summary: firstSentences(e.explanation, 650),
      note: `Fix: ${firstSentences(e.fix, 600)}\nMore: sygnal-check explain ${e.code}`,
    })
  }

  const keys = [...entries.keys()].sort()
  const finished = Object.fromEntries(keys.map((k) => [k, finish(entries.get(k))]))
  const statics = keys.filter((k) => entries.get(k).kind === 'static').map((k) => k.slice('Component.'.length))
  const memberNames = [...owners.keys()].sort()
  return { format: 1, sygnal: version, statics, memberNames, aliases: Object.fromEntries(Object.entries(aliases).sort()), entries: finished }
}

// grep must find what the CLI finds: each alias is a heading that names its target.
const aliasSection = (ref) => '\n' + Object.entries(ref.aliases).map(([key, to]) => `## ${key}\n\nSee ${to}\n`).join('\n')

function toMarkdown(ref) {
  const head = `# Sygnal reference (${ref.sygnal})\n\nOne heading per symbol. Find one with: grep -n -A14 -E '^## (.*\\.)?NAME$' node_modules/sygnal/dist/reference.md\n`
  return head + '\n' + Object.entries(ref.entries).map(([key, e]) => `## ${key}\n\n${textOf(e)}\n`).join('\n') + aliasSection(ref)
}

export function outputs(contextDir = repo, outDir = path.join(repo, 'dist')) {
  const ref = generate({ contextDir })
  return [
    { file: path.join(outDir, 'reference.json'), text: JSON.stringify(ref) + '\n', ref },
    { file: path.join(outDir, 'reference.md'), text: toMarkdown(ref) },
  ]
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arg = (name) => { const i = process.argv.indexOf(name); return i < 0 ? undefined : path.resolve(process.argv[i + 1]) }
  const files = outputs(arg('--context') ?? repo, arg('--out') ?? path.join(repo, 'dist'))
  if (process.argv.includes('--check')) {
    const bad = files.filter((f) => !fs.existsSync(f.file) || fs.readFileSync(f.file, 'utf8') !== f.text).map((f) => path.relative(repo, f.file))
    if (bad.length) { console.error(`stale reference (run node scripts/build-reference.mjs):\n  ${bad.join('\n  ')}`); process.exit(1) }
    console.log('the reference is up to date')
  } else {
    for (const f of files) { fs.mkdirSync(path.dirname(f.file), { recursive: true }); fs.writeFileSync(f.file, f.text) }
    console.log(`wrote ${Object.keys(files[0].ref.entries).length} answers (${files.map((f) => `${path.basename(f.file)} ${Math.round(bytes(f.text) / 1024)} KB`).join(', ')})`)
  }
}
