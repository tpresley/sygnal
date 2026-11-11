#!/usr/bin/env node
// A prototype of a `sygnal-check docs` command (or an MCP tool of the same shape): the reference
// on demand, keyed by what the agent has in hand, so it never has to open the 390 KB dist/index.d.ts
// or carry option lists in context. Runs from a project (or with SYGNAL_DIR pointing at a package):
//   sygnal-docs FetchRequest        the declaration with its JSDoc (or a member: `sygnal-docs latest`)
//   sygnal-docs sygnal/yjs          the docs for an import specifier
//   sygnal-docs ./src               which subpaths the code imports, and what to read for each
import fs from 'node:fs'
import path from 'node:path'

const pkg = process.env.SYGNAL_DIR ?? path.resolve('node_modules/sygnal')
const SUBPATH_DOCS = {
  'sygnal/ai': ['llms/ai.md', 'dist/guide/ai-chat.md', 'dist/guide/agent.md', 'dist/guide/ai-decisions.md'],
  'sygnal/ui': ['llms/ui.md', 'dist/guide/ui/overview.md'],
  'sygnal/ui/menu': ['llms/ui.md', 'dist/guide/ui/menu.md'],
  'sygnal/ui/select': ['llms/ui.md', 'dist/guide/ui/select.md'],
  'sygnal/ui/combobox': ['llms/ui.md', 'dist/guide/ui/combobox.md'],
  'sygnal/three': ['llms/graphics.md', 'dist/guide/renderers/three.md'],
  'sygnal/canvas': ['llms/graphics.md', 'dist/guide/islands.md'],
  'sygnal/api': ['llms/typed-apis.md', 'dist/guide/typed-apis.md'],
  'sygnal/yjs': ['llms/collaboration.md', 'dist/guide/collaborative-state.md'],
  'sygnal/replay': ['llms/replay.md'],
  'sygnal/sandbox': ['llms/sandbox.md', 'dist/guide/sandboxed-components.md'],
  'sygnal/terminal': ['llms/renderers.md', 'dist/guide/renderers/terminal.md'],
  'sygnal/agent-ui': ['llms/renderers.md', 'dist/guide/renderers/agent-ui.md'],
  'sygnal/react-native': ['llms/renderers.md', 'dist/guide/renderers/react-native.md'],
  'sygnal/primitives': ['llms/renderers.md', 'dist/guide/renderers/write-once.md'],
  'sygnal/host': ['llms/renderers.md', 'dist/guide/renderers/custom-targets.md'],
  'sygnal/worker': ['llms/renderers.md'],
}

/** The declaration of `name`, with the JSDoc right before it, from a .d.ts text. */
export function declaration(text, name) {
  const at = text.search(new RegExp(`^(?:export )?(?:declare )?(?:interface|type|function|const|class) ${name}\\b`, 'm'))
  if (at < 0) return null
  const before = text.slice(0, at).trimEnd()
  const start = before.endsWith('*/') ? before.lastIndexOf('/**') : at
  let i = at, depth = 0, seen = false
  for (; i < text.length; i++) {
    const c = text[i]
    if ('{([<'.includes(c)) { depth++; seen = true }
    if ('})]'.includes(c) || (c === '>' && text[i - 1] !== '=')) depth--
    if (!seen && c === ';') break
    if (seen && depth <= 0 && /[\n;]/.test(text[i + 1] ?? '\n') && /[})\]]|[\w'"]/.test(c)) { i++; break }
  }
  return text.slice(start, i).trim()
}

/** Members named `name` in any interface, with their JSDoc. */
export function members(text, name) {
  const out = []
  for (const m of text.matchAll(new RegExp(`^( *)${name}\\??:[^\\n]*`, 'gm'))) {
    const before = text.slice(0, m.index).trimEnd()
    out.push((before.endsWith('*/') ? before.slice(before.lastIndexOf('/**')) + '\n' : '') + m[0].trim())
  }
  return out
}

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? (e.name === 'node_modules' ? [] : walk(path.join(dir, e.name))) : [path.join(dir, e.name)]))
}

export function lookup(arg) {
  if (arg.startsWith('sygnal/')) {
    const files = SUBPATH_DOCS[arg]
    return files ? `${arg}: read ${files.join(', ')} (under node_modules/sygnal/)` : `${arg}: no docs entry`
  }
  if (fs.existsSync(arg) && fs.statSync(arg).isDirectory()) {
    const seen = new Set()
    for (const f of walk(arg).filter((x) => /\.[jt]sx?$/.test(x))) for (const m of fs.readFileSync(f, 'utf8').matchAll(/from\s+'(sygnal\/[\w/-]+)'/g)) seen.add(m[1])
    return [...seen].sort().map(lookup).join('\n') || 'no sygnal/* imports'
  }
  const texts = ['dist/index.d.ts', ...fs.readdirSync(path.join(pkg, 'dist')).filter((f) => /^(?!index)[\w-]+\.d\.ts$/.test(f)).map((f) => `dist/${f}`)].map((f) => fs.readFileSync(path.join(pkg, f), 'utf8'))
  for (const t of texts) {
    const d = declaration(t, arg)
    if (d) return d
  }
  const ms = [...new Set(texts.flatMap((t) => members(t, arg)))]
  return ms.length ? ms.slice(0, 8).join('\n\n') : `no declaration or member named ${arg}`
}

if (process.argv[2]) console.log(lookup(process.argv[2]))
else console.error('usage: sygnal-docs <TypeName | member | sygnal/subpath | dir>')
