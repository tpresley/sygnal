/**
 * sygnal-check diagnostics ⇄ LSP (PLAN-7 L-1). Pure functions, used in the check worker
 * (core.js) and on the main thread (server.js).
 *
 * A checker Diagnostic (1-based line/column, endColumn exclusive, UTF-16: C-2) becomes:
 *
 *   { range, severity, code, codeDescription: { href: docsUrl }, source: 'sygnal',
 *     message: 'Component: message (fix)',          // as the CLI prints it (D307: self-contained)
 *     relatedInformation?: [{ location, message }], // from `related`
 *     data: { fixes?, suppress? } }
 *
 *   range     0-based; a finding without an end (a config file's SYG900) underlines the token
 *             at its start (a quoted string, else an identifier-like run, else one character)
 *   severity  error → 1, warn → 2, info → 3
 *   data.fixes    the C-4 fixes as LSP edits: [{ title, kind, preferred?, fixAll?,
 *                 edits: [{ uri, range, newText }] }] (an edit may be in another file)
 *   data.suppress the "Suppress SYGnnn on this line" insertion: { line, newText } (a
 *                 `sygnal-ignore-next-line` comment above the finding's first line, indented
 *                 like it; the JSX form `{/* … *\/}` when that line is inside JSX children)
 *
 * Code actions read these from the server's last results, so they need no re-check.
 */
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { childNodes } from '../ast.js'
import { lineStarts } from '../edits.js'

export const SEVERITY = Object.freeze({ error: 1, warn: 2, info: 3 })

/** The CLI's message text: `Component: message (fix)`. */
export function messageOf(d) {
  return `${d.component ? d.component + ': ' : ''}${d.message}${d.fix ? ` (${d.fix})` : ''}`
}

/** End of the token at 0-based `col0` of `line` (the PoC's fallback range for a finding without an end). */
export function tokenEnd(line, col0) {
  const q = line[col0]
  if (q === "'" || q === '"' || q === '`') {
    const e = line.indexOf(q, col0 + 1)
    return e < 0 ? line.length : e + 1
  }
  const m = /^[\w$.-]+/.exec(line.slice(col0))
  return col0 + (m ? m[0].length : 1)
}

/** The 0-based LSP range of a 1-based checker location; `textOf()` gives the file's text for the fallback. */
export function rangeOf(loc, textOf) {
  const start = { line: Math.max(0, loc.line - 1), character: Math.max(0, (loc.column || 1) - 1) }
  if (loc.endLine !== undefined && loc.endColumn !== undefined) {
    return { start, end: { line: Math.max(0, loc.endLine - 1), character: Math.max(0, loc.endColumn - 1) } }
  }
  const text = textOf?.() ?? ''
  const lineText = text.split(/\r?\n/)[start.line] ?? ''
  return { start, end: { line: start.line, character: Math.max(start.character + 1, tokenEnd(lineText, start.character)) } }
}

const toUri = (abs) => pathToFileURL(abs).href

/** A C-4 fix (paths relative to `folder`) as LSP edits. */
export function fixToLsp(fix, folder) {
  return {
    title: fix.title,
    kind: fix.kind || 'quickfix',
    ...(fix.preferred ? { preferred: true } : {}),
    ...(fix.fixAll ? { fixAll: true } : {}),
    edits: fix.edits.map(e => ({ uri: toUri(path.resolve(folder, e.file)), range: rangeOf(e), newText: e.text })),
  }
}

/**
 * One checker Diagnostic as an LSP Diagnostic. `folder` resolves its relative paths;
 * `textOf(absPath)` reads a file's text (for the fallback range); `file` is the parsed
 * FileInfo of the finding's file when there is one (for the suppression's JSX test).
 */
export function toLspDiagnostic(d, { folder, textOf, file }) {
  const abs = path.resolve(folder, d.file)
  const out = {
    range: rangeOf(d, () => textOf(abs)),
    severity: SEVERITY[d.severity] || 2,
    code: d.code,
    codeDescription: { href: d.docsUrl },
    source: 'sygnal',
    message: messageOf(d),
  }
  if (d.related?.length) {
    out.relatedInformation = d.related.map(r => ({
      location: { uri: toUri(path.resolve(folder, r.file)), range: rangeOf(r, () => textOf(path.resolve(folder, r.file))) },
      message: r.message || d.message,
    }))
  }
  const data = {}
  if (d.fixes?.length) data.fixes = d.fixes.map(f => fixToLsp(f, folder))
  const source = file?.source ?? textOf(abs)
  if (typeof source === 'string' && d.line >= 1) data.suppress = suppressionFor(source, d.line, d.code, file?.ast)
  out.data = data
  return out
}

/** A cheap fingerprint of a text (FNV-1a and the length): which text a result's ranges and fixes refer to. */
export function textHash(text) {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193)
  return `${text.length}:${(h >>> 0).toString(36)}`
}

/** Errors first, then warnings, then info; the checker's file/line order inside each. */
export function sortBySeverity(list) {
  return list
    .map((d, i) => [d, i])
    .sort((a, b) => a[0].severity - b[0].severity || a[1] - b[1])
    .map(([d]) => d)
}

/**
 * The suppression comment for a finding starting on 1-based `line`: inserted at the start of
 * that line, so it ends on the line above the finding (src/model/project.js matches a comment
 * on the finding's line or the line before; `-next-line` reads as intended).
 */
export function suppressionFor(source, line, code, ast) {
  const starts = lineStarts(source)
  const lineStart = starts[line - 1] ?? source.length
  const lineEnd = starts[line] ?? source.length
  const lineText = source.slice(lineStart, lineEnd).replace(/\r?\n$|\r$/, '')
  const indent = /^[ \t]*/.exec(lineText)[0]
  const eol = source.includes('\r\n') ? '\r\n' : '\n'
  const jsx = ast ? inJsxChildren(ast, lineStart + indent.length) : false
  const comment = jsx ? `{/* sygnal-ignore-next-line ${code} */}` : `// sygnal-ignore-next-line ${code}`
  return { line: line - 1, newText: indent + comment + eol }
}

const JSX_PARENT = new Set(['JSXElement', 'JSXFragment'])

/**
 * Whether a line starting at `offset` sits in JSX children (where `//` would become text): the
 * outermost node starting there is a child of a JSX element or fragment, or that element's
 * closing tag, or the line starts inside JSX text.
 */
export function inJsxChildren(ast, offset) {
  let node = ast.program
  let first = null
  let firstParent = null
  for (;;) {
    let next = null
    for (const c of childNodes(node)) {
      if (typeof c.start === 'number' && c.start <= offset && offset < c.end) { next = c; break }
    }
    if (!next) break
    if (!first && next.start === offset) { first = next; firstParent = node }
    node = next
  }
  if (node.type === 'JSXText') return true
  if (!first || !firstParent || !JSX_PARENT.has(firstParent.type)) return false
  if (first.type === 'JSXClosingElement' || first.type === 'JSXClosingFragment') return true
  return !!firstParent.children?.includes(first)
}
