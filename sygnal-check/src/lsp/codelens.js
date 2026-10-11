/**
 * Code lens (PLAN-7 P4-4): a line of text above each intent action key, model key, EVENTS select
 * and EVENTS emit, from the occurrence index (model/positions.js) and its `flow` (flow.js).
 *
 *   createCodeLens({ nav, caps, initOptions, enabled, folderOf, uriFor, requestClient, log? }) → {
 *     codeLens(params) → CodeLens[] | null | Promise<…>
 *     executeCommand(params) → Location[]            (the server command, GO_TO)
 *     checked(folder, entry)                          after a check: refresh when the lenses changed
 *     drop(folder)
 *   }
 *
 * Titles:
 *   intent key   `handled by model.SAVE · STATE, HTTP → LOADED/FAILED, EVENTS 'SAVED' · next → DONE`;
 *                `no model entry` (exactly when SYG101 reports it); `handled by behavior c` (a
 *                behavior-owned name); `handler not known statically` (a model with spreads)
 *   model key    `triggered by intent, reply (HTTP ok from SAVE), next from SAVE, agent tool,
 *                timer, connection (message), resource, route, browser, behavior c, persist,
 *                the core`; `not triggered` (exactly when SYG102 reports it; `not triggered
 *                (a dynamic name might)` when it's info); `trigger not known statically`
 *   EVENTS       on a select: `N emitters` (`no emitters`); on an emit: `N listeners`
 *   Several components at one position (a shared model) prefix their component's name; undoable()'s
 *   UNDO / REDO (both at the callee) prefix the action.
 *
 * Commands (the LSP doesn't standardize any; decided once from the client's capabilities):
 *   - the client lists a client command in `capabilities.experimental.commands.commands` (the
 *     rust-analyzer convention) or in `initializationOptions.clientCommands`:
 *     'sygnal.showReferences' (preferred: the VS Code extension's, which converts the arguments)
 *     or 'editor.action.showReferences' → that command with `[uri, position, locations]`;
 *   - else, when the client supports `window/showDocument` → the server command GO_TO
 *     (`executeCommandProvider`) with `[{ uri, position, locations }]`: executing it shows the first
 *     location (window/showDocument) and returns them all;
 *   - else title-only lenses (`command: ''`), and every lens without a target is title-only too.
 *
 * Freshness: navigation.js's (the kept index when it matches the open documents, else the
 * worker's `index` call). After a check, when the lenses of the folder (titles and targets)
 * differ from the previous check's, `workspace/codeLens/refresh` is sent if the client supports
 * it (`workspace.codeLens.refreshSupport`). The setting `sygnal.codeLens: false` → no lenses (and
 * a refresh, so the client drops the shown ones).
 */
import { uriToPath } from './protocol.js'
import { textHash } from './convert.js'

export const GO_TO = 'sygnal.goTo'
const CLIENT_COMMANDS = ['sygnal.showReferences', 'editor.action.showReferences']

const plural = (n, one, many) => n === 0 ? `no ${many}` : n === 1 ? `1 ${one}` : `${n} ${many}`
const then = (v, f) => typeof v?.then === 'function' ? v.then(f) : f(v)
const posOf = (o) => ({ line: o.hit.line - 1, character: o.hit.column - 1 })
const rangeOf = (r) => ({ start: { line: r.line - 1, character: r.column - 1 }, end: { line: r.endLine - 1, character: r.endColumn - 1 } })

/** How lenses jump to their targets with this client: a client command name, GO_TO, or null (title only). */
export function commandStrategy(caps = {}, initOptions = {}) {
  const listed = [caps.experimental?.commands?.commands, initOptions?.clientCommands, initOptions?.sygnal?.clientCommands]
    .flatMap(l => Array.isArray(l) ? l : [])
  const client = CLIENT_COMMANDS.find(c => listed.includes(c))
  if (client) return client
  if (caps.window?.showDocument?.support) return GO_TO
  return null
}

export function createCodeLens({ nav, caps, initOptions, enabled, folderOf, uriFor, requestClient, log = () => {} }) {
  const signatures = new Map() // folder → signature of the last check's lenses
  let strategy
  const strategyNow = () => strategy === undefined ? (strategy = commandStrategy(caps(), initOptions())) : strategy

  const location = (o) => ({ uri: uriFor(o.file), range: rangeOf(o) })

  /** The lenses of one file of an index entry: [{ occ, title, targets }]. */
  function lensesOf(entry, abs) {
    const { lookup, index } = entry
    const flow = index.flow || {}
    const names = new Map(index.components.map(c => [c.id, c.name]))
    const occs = index.occurrences.filter(o => o.file === abs)
    const out = []
    for (const o of occs) {
      let lens = null
      if (o.kind === 'intent') lens = intentLens(o, flow[o.component], lookup)
      else if (o.kind === 'model') lens = modelLens(o, flow[o.component], lookup)
      else if (o.role === 'select' && !o.implicit) {
        const emits = lookup.definition([o])
        lens = { title: plural(emits.length, 'emitter', 'emitters'), targets: emits }
      } else if (o.role === 'emit') {
        const selects = lookup.definition([o])
        lens = { title: plural(selects.length, 'listener', 'listeners'), targets: selects }
      }
      if (lens) out.push({ occ: o, ...lens })
    }
    // several lenses at one position: a model shared by components (their names), UNDO / REDO
    const at = new Map()
    for (const l of out) {
      const k = `${l.occ.hit.start}\0${l.occ.kind}`
      if (!at.has(k)) at.set(k, [])
      at.get(k).push(l)
    }
    for (const group of at.values()) {
      if (group.length < 2) continue
      const sameName = group.every(l => l.occ.name === group[0].occ.name)
      for (const l of group) l.title = `${sameName ? names.get(l.occ.component) ?? '?' : l.occ.name}: ${l.title}`
    }
    return out
  }

  function intentLens(o, f, lookup) {
    const handlers = lookup.definition([o])
    if (handlers.length) {
      const parts = [`handled by model.${o.name}`]
      const ent = f?.entries?.[o.name]
      if (ent) {
        const sinks = ent.sinks.map(s => {
          if (s === 'EVENTS') return ent.events.length ? `EVENTS ${ent.events.map(t => `'${t}'`).join(' ')}` : 'EVENTS'
          const replies = ent.replies.filter(r => r.sink === s).map(r => r.name)
          return replies.length ? `${s} → ${[...new Set(replies)].join('/')}` : s
        })
        if (sinks.length) parts.push(sinks.join(', '))
        if (ent.next.length) parts.push(`next → ${ent.next.join(', ')}`)
      }
      return { title: parts.join(' · '), targets: handlers }
    }
    if (f?.unhandled?.includes(o.name)) return { title: 'no model entry', targets: [] }
    const owner = lookup.references([o]).find(x => x.kind === 'uses')
    if (owner) return { title: `handled by behavior ${owner.behavior}`, targets: [owner] }
    return { title: 'handler not known statically', targets: [] }
  }

  function modelLens(o, f, lookup) {
    const triggers = lookup.references([o], false)
    const labels = []
    const add = (l) => { if (!labels.includes(l)) labels.push(l) }
    if (o.builtin) add('the core')
    const entries = Object.entries(f?.entries || {})
    for (const t of triggers) {
      switch (t.kind) {
        case 'intent': add('intent'); break
        case 'next': {
          const from = entries.filter(([, e]) => e.next.includes(o.name)).map(([a]) => a)
          if (from.length) for (const a of from) add(`next from ${a}`)
          else add('next()')
          break
        }
        case 'reply': {
          const from = entries.filter(([, e]) => e.replies.some(r => r.sink === t.sink && r.key === t.key && r.name === o.name)).map(([a]) => a)
          add(`reply (${[t.sink, t.key].filter(Boolean).join(' ')}${from.length ? ` from ${from.join(', ')}` : ''})`)
          break
        }
        case 'agent': add('agent tool'); break
        case 'connection': add(t.key ? `connection (${t.key})` : 'connection'); break
        case 'uses': add(`behavior ${t.behavior}`); break
        default:
          // a user behavior's own intent / next / reply / timer / option naming the action (P4-3)
          if (t.kind.startsWith('behavior-')) add(`behavior ${t.behavior}`)
          else add(t.kind) // timer, resource, route, browser
      }
    }
    for (const l of f?.extra?.[o.name] || []) add(l)
    if (labels.length) return { title: `triggered by ${labels.join(', ')}`, targets: triggers }
    const verdict = f?.untriggered?.[o.name]
    if (verdict) return { title: verdict === 'info' ? 'not triggered (a dynamic name might)' : 'not triggered', targets: [] }
    return { title: 'trigger not known statically', targets: [] }
  }

  function toLsp(l) {
    const range = rangeOf(l.occ.hit)
    const how = strategyNow()
    if (!l.targets.length || !how) return { range, command: { title: l.title, command: '' } }
    const uri = uriFor(l.occ.file)
    const locations = l.targets.map(location)
    const position = posOf(l.occ)
    return {
      range,
      command: how === GO_TO
        ? { title: l.title, command: GO_TO, arguments: [{ uri, position, locations }] }
        : { title: l.title, command: how, arguments: [uri, position, locations] },
    }
  }

  function codeLens(params) {
    const abs = uriToPath(params.textDocument?.uri)
    const folder = abs && folderOf(abs)
    if (!folder) return null
    if (!enabled(folder)) return []
    return then(nav.entryFor(abs), (entry) => entry?.index ? lensesOf(entry, abs).map(toLsp) : null)
  }

  function executeCommand(params) {
    if (params.command !== GO_TO) return null
    const arg = params.arguments?.[0]
    const locations = Array.isArray(arg?.locations) ? arg.locations : []
    const first = locations[0]
    if (first && caps().window?.showDocument?.support) {
      requestClient('window/showDocument', { uri: first.uri, takeFocus: true, selection: first.range }, 5000)
    }
    return locations
  }

  /** The folder's lenses (titles and targets, every file) as one hash; 'off' when disabled. */
  function signatureOf(folder, entry) {
    if (!enabled(folder)) return 'off'
    if (!entry?.index) return ''
    const parts = []
    for (const abs of new Set(entry.index.occurrences.map(o => o.file))) {
      for (const l of lensesOf(entry, abs)) {
        parts.push(`${abs}\0${l.title}\0${l.targets.map(t => `${t.file}:${t.line}:${t.column}`).join(',')}`)
      }
    }
    return textHash(parts.join('\n'))
  }

  function checked(folder, entry) {
    let sig
    try {
      sig = signatureOf(folder, entry)
    } catch (err) {
      log('error', `code lens: ${err?.stack || err}`) // never in the way of the check's diagnostics
      return
    }
    const prev = signatures.get(folder)
    signatures.set(folder, sig)
    if (prev === undefined || prev === sig) return
    if (!caps().workspace?.codeLens?.refreshSupport) return
    log('debug', `code lens: lenses changed in ${folder}; asking the client to refresh`)
    requestClient('workspace/codeLens/refresh', undefined, 5000)
  }

  const drop = (folder) => { signatures.delete(folder) }

  return { codeLens, executeCommand, checked, drop }
}
