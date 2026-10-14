/**
 * Highlights: Sygnal's wiring as semantic tokens, from the occurrence index (model/positions.js),
 * the same data go to definition and rename use, so a highlighted name is a name the checker
 * resolved (nothing guessed).
 *
 *   createHighlights({ nav, caps, initOptions, enabled, folderOf, requestClient, notify, log? }) → {
 *     provider()                         the `semanticTokensProvider` capability, or undefined
 *     full(params)                       textDocument/semanticTokens/full → { data } | null | Promise
 *     decoded(params)                    sygnal/highlights → Token[] | null | Promise (below)
 *     checked(folder, entry)             after a check's index: tell the client when the folder's
 *                                        highlights changed (the same entry again, or none: nothing)
 *     drop(folder)
 *   }
 *   tokensOf(entry, abs) → Token[] | null    Token = { line, character, length, type, modifiers }
 *                                            (0-based, single-line, sorted, no overlaps)
 *   encode(tokens) → number[]                the LSP's relative encoding
 *
 * Types (custom; `LEGEND`):
 *   sygnalAction    an action name: intent key, model key, next(), reply, timer, behavior, ...
 *   sygnalEvent     an EVENTS type (emit / select)
 *   sygnalSelector  a class / id / control token of an intent selector (`DOM.click('.save')`)
 *   sygnalTarget    a view token an intent selector of its scope targets (className, id, an
 *                   `<Add>` control tag); classes no intent selects get no token
 *   sygnalChild     a child component: `CHILD.select(Child)`, the `<Child>` tags and
 *                   `<Collection of={Child}>` of the selecting component's view, and Child's name
 * Modifiers: declaration (model key, emit, rendered target, component name), handler / trigger,
 *   unhandled (an intent action no model entry handles), untargeted (a selector nothing renders),
 *   unverified (no static class / id renders it, but a dynamic one in the view might).
 *
 * Clients. A client that merges semantic tokens from several servers (Neovim, Emacs lsp-mode,
 * Sublime LSP, LSP4IJ) uses `textDocument/semanticTokens/full`. VS Code asks only one provider per
 * document (the first of the highest-scored group that answers), so ours would replace
 * TypeScript's: its extension passes `initializationOptions.semanticTokens: false` (no provider),
 * asks `sygnal/highlights` for the decoded tokens and draws decorations.
 *
 * Freshness: navigation.js's (null while the index doesn't match the document: the client keeps
 * what it shows). After a check whose highlights differ from the previous check's (any file of the
 * folder), `workspace/semanticTokens/refresh` when the client supports it and has the provider;
 * the notification `sygnal/highlightsChanged` after such a check and after the first one, when
 * the client asked for it (`initializationOptions.highlightsChanged: true`). The setting `sygnal.highlights: false` → empty
 * tokens (and a refresh).
 */
import { uriToPath } from './protocol.js'
import { textHash } from './convert.js'

export const LEGEND = {
  tokenTypes: ['sygnalAction', 'sygnalEvent', 'sygnalSelector', 'sygnalTarget', 'sygnalChild'],
  tokenModifiers: ['declaration', 'handler', 'trigger', 'unhandled', 'untargeted', 'unverified'],
}
const TYPE = new Map(LEGEND.tokenTypes.map((t, i) => [t, i]))
const MOD = new Map(LEGEND.tokenModifiers.map((m, i) => [m, 1 << i]))

const cache = new WeakMap() // index → Map<file, tokens>

function classify(index) {
  const out = new Map()
  const push = (file, r, type, modifiers = []) => {
    if (!r || r.line !== r.endLine || r.endColumn <= r.column) return // LSP tokens are single-line
    if (!out.has(file)) out.set(file, [])
    out.get(file).push({ line: r.line - 1, character: r.column - 1, length: r.endColumn - r.column, type, modifiers })
  }
  const occs = index.occurrences
  // which view tokens are targeted: dom/control selectors by (kind, name|target) → their scopes
  const selected = new Map()
  const handled = new Set() // component\0action of model handlers
  const childSelects = new Set() // component\0target
  const selectedChildren = new Set() // targets some component's CHILD.select names
  for (const o of occs) {
    if ((o.ns === 'dom' || o.ns === 'control') && o.role === 'selector') {
      const k = o.ns === 'dom' ? `${o.kind}\0${o.name}` : `control\0${o.target}`
      if (!selected.has(k)) selected.set(k, new Set())
      for (const s of o.scopes || []) selected.get(k).add(s)
      if (o.childScope) selected.get(k).add(o.childScope)
    } else if (!o.ns && o.role === 'handler') handled.add(`${o.component}\0${o.name}`)
    else if (o.ns === 'child' && o.kind === 'child-select') { childSelects.add(`${o.component}\0${o.target}`); selectedChildren.add(o.target) }
  }
  // a view whose class names / ids the checker can't read might render any selector
  const opaque = new Map((index.components || []).map(c => [c.id, c.flags || {}]))
  const unknownView = (o) => { const f = opaque.get(o.component) || {}; return o.kind === 'id' ? f.dynamicIds : o.ns === 'dom' && f.dynamicClasses }

  for (const o of occs) {
    if (!o.ns) {
      if (o.role === 'emit' || o.role === 'select') push(o.file, o, 'sygnalEvent', o.role === 'emit' ? ['declaration'] : [])
      else {
        const mods = [o.role === 'handler' ? 'handler' : 'trigger']
        if (o.role === 'handler') mods.push('declaration')
        if (o.kind === 'intent' && !o.builtin && !handled.has(`${o.component}\0${o.name}`)) mods.push('unhandled')
        push(o.file, o, 'sygnalAction', mods)
      }
    } else if (o.ns === 'dom' || o.ns === 'control') {
      const k = o.ns === 'dom' ? `${o.kind}\0${o.name}` : `control\0${o.target}`
      if (o.role === 'selector') push(o.file, o, 'sygnalSelector', !o.missing ? [] : o.dynamic || unknownView(o) ? ['unverified'] : ['untargeted'])
      else if (o.role === 'render' && selected.get(k)?.has(o.scope)) push(o.file, o, 'sygnalTarget', ['declaration'])
    } else if (o.ns === 'child') {
      if (o.kind === 'child-select') push(o.file, o, 'sygnalChild')
      else if (o.kind === 'component' && selectedChildren.has(o.target)) push(o.file, o, 'sygnalChild', ['declaration'])
    }
  }
  for (const t of index.tags || []) {
    if (childSelects.has(`${t.component}\0${t.target}`)) push(t.file, t, 'sygnalChild')
  }
  for (const list of out.values()) {
    list.sort((a, b) => a.line - b.line || a.character - b.character || b.length - a.length)
    // no overlaps (LSP): keep the first (the longest at a position)
    let end = { line: -1, character: -1 }
    for (let i = 0; i < list.length; i++) {
      const t = list[i]
      if (t.line === end.line && t.character < end.character) { list.splice(i--, 1); continue }
      end = { line: t.line, character: t.character + t.length }
    }
  }
  return out
}

const byFileOf = (index) => {
  let byFile = cache.get(index)
  if (!byFile) cache.set(index, byFile = classify(index))
  return byFile
}

export function tokensOf(entry, abs) {
  return entry?.index ? byFileOf(entry.index).get(abs) || [] : null
}

export function encode(tokens) {
  const data = []
  let line = 0, ch = 0
  for (const t of tokens) {
    const dl = t.line - line
    data.push(dl, dl ? t.character : t.character - ch, t.length, TYPE.get(t.type), t.modifiers.reduce((m, x) => m | MOD.get(x), 0))
    line = t.line; ch = t.character
  }
  return data
}

const then = (v, f) => typeof v?.then === 'function' ? v.then(f) : f(v)

export function createHighlights({ nav, caps, initOptions, enabled, folderOf, requestClient, notify, log = () => {} }) {
  const signatures = new Map() // folder → signature of the last check's highlights
  const lastEntry = new Map() // folder → the index entry they were computed from
  const advertised = () => initOptions()?.semanticTokens !== false

  function decoded(params) {
    const abs = uriToPath(params?.textDocument?.uri)
    const folder = abs && folderOf(abs)
    if (!folder) return null
    if (!enabled(folder)) return []
    return then(nav.entryFor(abs), (entry) => tokensOf(entry, abs))
  }

  function full(params) {
    return then(decoded(params), (list) => list ? { data: encode(list) } : null)
  }

  function checked(folder, entry) {
    if (!entry?.index || lastEntry.get(folder) === entry) return
    lastEntry.set(folder, entry)
    let sig
    try {
      if (!enabled(folder)) sig = 'off'
      else {
        const files = [...byFileOf(entry.index)].filter(([f]) => folderOf(f) === folder).sort((a, b) => a[0] < b[0] ? -1 : 1)
        sig = textHash(JSON.stringify(files))
      }
    } catch (err) {
      log('error', `highlights: ${err?.stack || err}`) // never in the way of the check's diagnostics
      return
    }
    const prev = signatures.get(folder)
    signatures.set(folder, sig)
    if (prev === sig) return
    // the first check: the client's first requests may have come before its index (null)
    if (initOptions()?.highlightsChanged === true) notify('sygnal/highlightsChanged', {})
    if (prev === undefined) return
    if (advertised() && caps().workspace?.semanticTokens?.refreshSupport) {
      log('debug', `highlights: changed in ${folder}; asking the client to refresh`)
      requestClient('workspace/semanticTokens/refresh', undefined, 5000)
    }
  }

  const drop = (folder) => { signatures.delete(folder); lastEntry.delete(folder) }
  const provider = () => advertised() ? { legend: LEGEND, full: true } : undefined

  return { provider, full, decoded, checked, drop }
}
