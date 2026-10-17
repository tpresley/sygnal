// The app graph panel's plain logic (PLAN-10 E-2): no `vscode` import, so the unit tests run in
// plain Node. graphPanel.ts wires it to VS Code.
import * as path from 'node:path'
import { randomBytes } from 'node:crypto'

/** The parts of an InspectGraph component the panel reads. */
export interface GraphComponent {
  name: string
  id: string
  key?: string | null
  file?: string | null
  ghost?: boolean
  [k: string]: unknown
}
export interface InspectGraph {
  version: number
  components: GraphComponent[]
  [k: string]: unknown
}
/** What `sygnal/graph` answers (sygnal-check's LSP, PLAN-10 E-1). */
export interface GraphAnswer {
  root: string
  version: number
  graph: InspectGraph | null
}

/** The line in a component id (`file:line`), or null. */
export function idLine(id: string): number | null {
  const m = /:(\d+)$/.exec(id)
  return m ? Number(m[1]) : null
}

/**
 * The key of the component the cursor is in: `file` relative to the root ('/'-separated), `line`
 * 1-based. The graph has no end lines, so a component's span runs from its line (the function) to
 * the line before the next component in the same file, which takes in statics written after the
 * function (intent, model, ...). Null before the first component, or for a file with none.
 */
export function componentKeyAt(graph: InspectGraph | null, file: string, line: number): string | null {
  if (!graph) return null
  let best: { line: number; key: string } | null = null
  for (const c of graph.components) {
    if (c.ghost || c.file !== file || !c.key) continue
    const at = idLine(c.id)
    if (at == null || at > line) continue
    if (!best || at > best.line) best = { line: at, key: c.key }
  }
  return best?.key ?? null
}

/**
 * The column (1-based) to open `file`:`line` at: the first location in the graph on that line (a
 * component's actions, selectors, EVENTS sites, children, ...; `file` where a location names its
 * own), else 1. The page's links carry only a line.
 */
export function columnFor(graph: InspectGraph | null, file: string, line: number): number {
  if (!graph) return 1
  let best: number | null = null
  const walk = (v: unknown, inFile: string | null | undefined): void => {
    if (Array.isArray(v)) { for (const x of v) walk(x, inFile); return }
    if (!v || typeof v !== 'object') return
    const o = v as Record<string, unknown>
    const f = typeof o.file === 'string' ? o.file : inFile
    if (f === file && o.line === line && typeof o.column === 'number' && (best == null || o.column < best)) best = o.column
    for (const [k, x] of Object.entries(o)) if (x && typeof x === 'object' && k !== 'diagnostics') walk(x, f)
  }
  for (const c of graph.components) walk(c, c.file)
  return best ?? 1
}

/** The absolute path of a link's `file` (relative to `root`), or null when it leaves the root. */
export function resolveInRoot(root: string, file: string): string | null {
  if (typeof file !== 'string' || !file || path.isAbsolute(file)) return null
  const abs = path.resolve(root, file)
  const rel = path.relative(root, abs)
  return !rel || rel.startsWith('..') || path.isAbsolute(rel) ? null : abs
}

/** A path relative to the root, '/'-separated as the graph has them, or null outside it. */
export function relativeInRoot(root: string, abs: string): string | null {
  const rel = path.relative(root, abs)
  return !rel || rel.startsWith('..') || path.isAbsolute(rel) ? null : rel.split(path.sep).join('/')
}

/** A nonce for the page's script (CSP). */
export const makeNonce = (): string => randomBytes(18).toString('base64')

/** The panel's title. */
export const panelTitle = (root: string): string => `App graph: ${path.basename(root)}`

/** A message from the webview (vscodeHost.js), checked; null for anything else. */
export type FromPage =
  | { type: 'ready'; version: number | null }
  | { type: 'open'; file: string; line: number }
  | { type: 'applied'; version: number | null; components: number }
  | { type: 'revealed'; key: string; selected: string | null }

export function readPageMessage(m: unknown): FromPage | null {
  if (!m || typeof m !== 'object') return null
  const o = m as Record<string, unknown>
  const version = typeof o.version === 'number' ? o.version : null
  switch (o.type) {
    case 'ready': return { type: 'ready', version }
    case 'open':
      return typeof o.file === 'string' && Number.isInteger(o.line) && (o.line as number) > 0 ? { type: 'open', file: o.file, line: o.line as number } : null
    case 'applied': return { type: 'applied', version, components: typeof o.components === 'number' ? o.components : 0 }
    case 'revealed': return typeof o.key === 'string' ? { type: 'revealed', key: o.key, selected: typeof o.selected === 'string' ? o.selected : null } : null
  }
  return null
}

/** The metadata graphHtml() gets for the panel (sygnal-check's graphView/html.js, `host: 'vscode'`). */
export function pageMeta(root: string, rootUri: string, version: number, nonce: string) {
  return {
    title: path.basename(root),
    subtitle: 'live · updates as you type',
    root: root.replace(/\\/g, '/'),
    rootUri,
    version,
    editor: 'vscode',
    host: 'vscode',
    nonce,
  }
}
