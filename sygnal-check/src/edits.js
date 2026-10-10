/**
 * Fixes as data (PLAN-7 C-4): text edits with offsets and 1-based line/column, and the
 * helpers rules use to build the common fixes.
 *
 * A diagnostic's `fixes` (makeDiagnostic, run.js):
 *
 *   [{ title, kind: 'quickfix' | 'refactor', preferred?, fixAll?, edits: [Edit] }]
 *   Edit = { file, start, end, line, column, endLine, endColumn, text }
 *
 * `file` is relative to `cwd` like the diagnostic's own; `start` / `end` are UTF-16 offsets
 * into that file's text, `line` / `column` .. `endLine` / `endColumn` the same range 1-based
 * (endColumn exclusive). An edit may be in another file than the finding. The edits of one fix
 * never overlap and are applied together. `fixAll` marks the mechanical rewrites `--fix`
 * applies (fixFiles); the others (a "did you mean" rename, a model stub, a removal) are for
 * an editor to offer.
 *
 * In a rule, `report({ fixes: [{ title, kind?, preferred?, fixAll?, edits: [{ file, start,
 * end, text }] }] })` with `file` an absolute path (or a FileInfo); the runner adds the
 * positions and makes the paths relative.
 */
import { unwrap } from './ast.js'

const IDENT = /^[A-Za-z_$][\w$]*$/

/** Offsets of the first character of each line. */
export function lineStarts(source) {
  const out = [0]
  for (let i = 0; i < source.length; i++) {
    const c = source.charCodeAt(i)
    if (c === 10) out.push(i + 1)
    else if (c === 13 && source.charCodeAt(i + 1) !== 10) out.push(i + 1)
  }
  return out
}

/** 1-based { line, column } of an offset (column in UTF-16 units, like Babel's loc). */
export function positionAt(starts, offset) {
  let lo = 0, hi = starts.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (starts[mid] <= offset) lo = mid; else hi = mid - 1
  }
  return { line: lo + 1, column: offset - starts[lo] + 1 }
}

/** A located edit: `{ file, start, end, line, column, endLine, endColumn, text }`. */
export function locateEdit(starts, file, { start, end, text }) {
  const a = positionAt(starts, start)
  const b = positionAt(starts, end)
  return { file, start, end, line: a.line, column: a.column, endLine: b.line, endColumn: b.column, text }
}

/** Apply non-overlapping `{ start, end, text }` edits to `source`. */
export function applyEdits(source, edits) {
  let out = source
  for (const e of [...edits].sort((a, b) => b.start - a.start || b.end - a.end)) {
    out = out.slice(0, e.start) + e.text + out.slice(e.end)
  }
  return out
}

/** The one edit that turns `before` into `after` (common prefix and suffix kept). */
export function diffEdit(before, after) {
  let start = 0
  const max = Math.min(before.length, after.length)
  while (start < max && before[start] === after[start]) start++
  let tail = 0
  while (tail < max - start && before[before.length - 1 - tail] === after[after.length - 1 - tail]) tail++
  return { start, end: before.length - tail, text: after.slice(start, after.length - tail) }
}

// ---------------------------------------------------------------- fix builders for rules

/** A string literal with `value`, quoted like `node` (a StringLiteral). */
function quoteLike(file, node, value) {
  const q = file.source[node.start] === '"' ? '"' : "'"
  return q + value.replace(/\\/g, '\\\\').replace(new RegExp(q, 'g'), '\\' + q) + q
}

/** Edit replacing a string literal (`'x'`, `"x"`, or a JSX attribute string) with `value`; null for anything else. */
export function stringEdit(file, node, value) {
  const n = unwrap(node)
  if (n?.type !== 'StringLiteral') return null
  // a JSX attribute string has no escapes: only replace when the value needs none
  const parent = file.parents?.get(n)
  if (parent?.type === 'JSXAttribute') {
    const q = file.source[n.start]
    if (value.includes(q) || value.includes('\n')) return null
    return { file: file.path, start: n.start, end: n.end, text: q + value + q }
  }
  return { file: file.path, start: n.start, end: n.end, text: quoteLike(file, n, value) }
}

/**
 * Edit renaming an object key (an identifier or string key; a shorthand `{ nxt }` becomes
 * `{ next: nxt }`); null for a computed key.
 */
export function keyEdit(file, keyNode, name) {
  if (!keyNode) return null
  const prop = file.parents?.get(keyNode)
  if (prop && prop.key === keyNode && prop.computed) return null
  if (keyNode.type === 'Identifier') {
    const text = IDENT.test(name) ? name : `'${name.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
    if (prop?.shorthand) return { file: file.path, start: keyNode.start, end: keyNode.end, text: `${text}: ${keyNode.name}` }
    return { file: file.path, start: keyNode.start, end: keyNode.end, text }
  }
  if (keyNode.type === 'StringLiteral') return { file: file.path, start: keyNode.start, end: keyNode.end, text: quoteLike(file, keyNode, name) }
  return null
}

/** A one-edit "did you mean" quick fix (preferred: the suggestion is the only one); undefined when `edit` is null. */
export function renameFix(title, edit, { preferred = true } = {}) {
  if (!edit) return undefined
  return [{ title, kind: 'quickfix', ...(preferred ? { preferred: true } : {}), edits: [edit] }]
}
