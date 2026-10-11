/**
 * textDocument/prepareRename and textDocument/rename (PLAN-7 P4-5) on the main thread of the
 * language server. What a rename edits, and every refusal, is model/rename.js's (run in the check
 * worker by core.js's `rename` call).
 *
 *   createRename({ checker, overlaysUnder, settingsFor, folderOf, uriFor, caps, log?, notify? }) → {
 *     prepareRename(params) → Promise<{ range, placeholder } | null>   (rejects with the refusal)
 *     rename(params) → Promise<WorkspaceEdit | null>                   (rejects with the refusal)
 *   }
 *
 * Freshness: a rename always runs on the open documents as they are (never on the kept index):
 * the worker builds the folder with the current overlays, and when an open document changed
 * while it did, the request fails ("try again") rather than edit stale positions.
 *
 * The WorkspaceEdit:
 *   - with change annotations (`workspace.workspaceEdit.changeAnnotationSupport` and
 *     `documentChanges`): `documentChanges` with annotated edits; the agent.actions keys (it
 *     changes the tool name an LLM sees) and the test files' edits are annotated
 *     `needsConfirmation: true`, each group under its own annotation;
 *   - otherwise `changes` with the code's edits only (the agent.actions keys included: they are
 *     part of the action), and a `window/showMessage` warning that the test files' mentions were
 *     left out: test edits are never applied without a confirmation.
 * Edits are deduplicated by `file:start:end` (a model shared by components).
 * Errors: a refusal is a ResponseError RequestFailed (-32803) with the reason as its message,
 * which VS Code shows (and then tries the next rename provider, TypeScript's).
 */
import { ResponseError, uriToPath } from './protocol.js'

export const RequestFailed = -32803
const ANNOTATIONS = {
  agent: { label: 'Agent tool name', description: 'renames a tool the LLM sees (agent.actions)', needsConfirmation: true },
  test: { label: 'Test files', description: 'mentions of the name in test files (strings and properties): check each one', needsConfirmation: true },
}
const MESSAGE = { error: 1, warning: 2, info: 3 }

const lsRange = (r) => ({ start: { line: r.line - 1, character: r.column - 1 }, end: { line: r.endLine - 1, character: r.endColumn - 1 } })

export function createRename({ checker, overlaysUnder, settingsFor, folderOf, uriFor, caps, log = () => {}, notify = () => {} }) {
  async function plan(params, newName) {
    const abs = uriToPath(params.textDocument?.uri)
    const pos = params.position
    if (!abs || !pos || typeof pos.line !== 'number' || typeof pos.character !== 'number') return null
    const folder = folderOf(abs)
    if (!folder) return null
    const sources = overlaysUnder(folder)
    const t0 = performance.now()
    const res = await checker.call('rename', {
      folder, settings: settingsFor(folder), sources, file: abs, line: pos.line + 1, column: pos.character + 1, newName,
    })
    // the open documents must still be what the plan was built from
    const now = overlaysUnder(folder)
    let changed = now.size !== sources.size
    for (const [k, v] of now) if (sources.get(k) !== v) changed = true
    if (changed) throw new ResponseError(RequestFailed, 'the documents changed while the rename was computed; try again')
    log('debug', `rename: ${res?.refused ? `refused (${res.refused})` : res ? `${res.kind} ${res.name}${res.edits ? `: ${res.edits.length} edit(s), ${res.tests.length} in test files` : ''}` : 'no Sygnal name'} in ${Math.round(performance.now() - t0)} ms`)
    if (res?.refused) throw new ResponseError(RequestFailed, res.refused)
    return res
  }

  async function prepareRename(params) {
    const res = await plan(params, null)
    return res ? { range: lsRange(res.range), placeholder: res.placeholder } : null
  }

  async function rename(params) {
    if (typeof params.newName !== 'string') throw new ResponseError(-32602, 'newName must be a string')
    const res = await plan(params, params.newName)
    if (!res) return null
    const ws = caps().workspace?.workspaceEdit || {}
    const annotated = !!ws.changeAnnotationSupport && !!ws.documentChanges
    for (const w of res.warnings || []) log('info', `rename: ${w}`)
    if (!annotated) {
      const changes = {}
      for (const e of res.edits) (changes[uriFor(e.file)] ||= []).push({ range: lsRange(e), newText: e.newText })
      if (res.tests.length) {
        const files = [...new Set(res.tests.map(e => e.file))]
        const message = `Sygnal rename: ${res.tests.length} mention(s) of ${res.name} in ${files.length} test file(s) were not renamed (this editor can't ask to confirm them): ${files.map(f => f.split(/[\\/]/).pop()).join(', ')}`
        notify(MESSAGE.warning, message)
        log('warn', message)
      }
      const agent = res.edits.find(e => e.group === 'agent')
      if (agent) notify(MESSAGE.info, `Sygnal rename: ${res.name} → ${res.newName} also renames the agent tool the LLM sees`)
      return { changes }
    }
    const byFile = new Map()
    const used = new Set()
    for (const e of [...res.edits, ...res.tests]) {
      const uri = uriFor(e.file)
      if (!byFile.has(uri)) byFile.set(uri, [])
      const edit = { range: lsRange(e), newText: e.newText }
      if (ANNOTATIONS[e.group]) { edit.annotationId = e.group; used.add(e.group) }
      byFile.get(uri).push(edit)
    }
    const changeAnnotations = {}
    for (const g of used) changeAnnotations[g] = ANNOTATIONS[g]
    return {
      documentChanges: [...byFile].map(([uri, edits]) => ({ textDocument: { uri, version: null }, edits })),
      ...(used.size ? { changeAnnotations } : {}),
    }
  }

  return { prepareRename, rename }
}
