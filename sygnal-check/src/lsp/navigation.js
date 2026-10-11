/**
 * Go to definition and find references (PLAN-7 N-2, actions and EVENTS) on the main thread of
 * the language server, from the occurrence index (model/positions.js).
 *
 *   createNavigation({ checker, overlaysUnder, settingsFor, folderOf, uriFor, log? }) → {
 *     snapshot(sources)                  before a check is sent: its sequence number and the
 *                                        hashes of the overlays it is sent with
 *     accept(folder, snap, result)       a check's (or an index call's) result: keeps its index
 *                                        when it is newer than the one kept
 *     track(folder, snap, promise)       a check in flight (settles after its accept())
 *     drop(folder)
 *     definition(params) → Location[] | null | Promise<…>
 *     references(params) → Location[] | null | Promise<…>
 *     entryFor(abs) → { lookup, index, … } | null | Promise<…>   (code lens: the same freshness)
 *   }
 *
 * Freshness. Every check (core.js) also returns the index of what it built, so the common case
 * (the cursor moves after typing paused and the check finished) is answered at once from the kept
 * index, without the worker. The kept index is used only when it was built from exactly the open
 * documents as they are now (same set of overlays, same text hashes) and the requested document
 * wasn't checked with its last good text. Otherwise (a document changed since the last check, a
 * request during the debounce) the request waits for a check in flight that was sent with the
 * documents as they are now (a save starts one at once), else it goes to the worker as an `index` call: the model is
 * built with the current overlays and the warm parse cache (no rules), and its index answers the
 * request and replaces the kept one. Concurrent stale requests share one call. A document that
 * doesn't parse has no occurrences of its own (its last good text's positions may be off):
 * requests in it get null; other files' targets are still found.
 */
import { uriToPath } from './protocol.js'
import { textHash } from './convert.js'
import { createLookup } from '../model/positions.js'

export function createNavigation({ checker, overlaysUnder, settingsFor, folderOf, uriFor, log = () => {} }) {
  const kept = new Map() // folder → { seq, hashes: Map<abs, hash>, substituted: Set, lookup }
  const pending = new Map() // folder → { signature, promise }
  const checking = new Map() // folder → { snap, promise }: the check in flight
  const hashCache = new Map() // abs → { text, hash }
  let seq = 0

  const hashOf = (abs, text) => {
    const c = hashCache.get(abs)
    if (c && c.text === text) return c.hash
    const hash = textHash(text)
    hashCache.set(abs, { text, hash })
    return hash
  }

  function snapshot(sources) {
    const hashes = new Map()
    for (const [abs, text] of sources) hashes.set(abs, hashOf(abs, text))
    return { seq: ++seq, hashes }
  }

  const entryOf = (snap, res) => ({
    seq: snap.seq,
    hashes: snap.hashes,
    substituted: new Set(res?.substituted || []),
    lookup: createLookup(res?.index || { components: [], occurrences: [] }),
    index: res?.index || null, // (code lens: its occurrences and `flow`)
  })

  function accept(folder, snap, res) {
    if (!res) return null
    // forget the hashes of documents closed since (the cache holds their text)
    for (const abs of hashCache.keys()) if (!snap.hashes.has(abs) && folderOf(abs) === folder) hashCache.delete(abs)
    const entry = entryOf(snap, res)
    const prev = kept.get(folder)
    if (!prev || prev.seq < snap.seq) kept.set(folder, entry)
    return entry
  }

  function track(folder, snap, promise) {
    const c = { snap, promise }
    checking.set(folder, c)
    const clear = () => { if (checking.get(folder) === c) checking.delete(folder) }
    promise.then(clear, clear)
  }

  function drop(folder) {
    kept.delete(folder)
    pending.delete(folder)
    checking.delete(folder)
  }

  /** Whether an index built from `hashes` matches the folder's open documents now. */
  const matches = (hashes, sources) => {
    if (hashes.size !== sources.size) return false
    for (const [abs, text] of sources) if (hashes.get(abs) !== hashOf(abs, text)) return false
    return true
  }

  /** The index to answer from for a document of `folder`: the kept one if fresh, else one from the worker. */
  function indexFor(folder) {
    const sources = overlaysUnder(folder)
    const k = kept.get(folder)
    if (k && matches(k.hashes, sources)) { log('debug', `navigation: from the last check's index (${folder})`); return k }
    const c = checking.get(folder)
    if (c && matches(c.snap.hashes, sources)) {
      log('debug', `navigation: waiting for the check in flight (${folder})`)
      return c.promise.then(() => { const k2 = kept.get(folder); return k2?.seq >= c.snap.seq ? k2 : null })
    }
    const snap = snapshot(sources)
    const signature = [...snap.hashes].map(([a, h]) => `${a}\0${h}`).sort().join('\n')
    const p = pending.get(folder)
    if (p && p.signature === signature) return p.promise
    const t0 = performance.now()
    const promise = checker.call('index', { folder, settings: settingsFor(folder), sources })
      .then(res => {
        log('debug', `navigation: documents changed since the last check; index built in ${Math.round(res?.ms ?? 0)} ms, answered in ${Math.round(performance.now() - t0)} ms (${folder})`)
        return accept(folder, snap, res) || entryOf(snap, res)
      }, (err) => { log('error', `navigation: index of ${folder} failed: ${err?.stack || err}`); return null })
      .finally(() => { if (pending.get(folder)?.promise === promise) pending.delete(folder) })
    pending.set(folder, { signature, promise })
    return promise
  }

  const location = (o) => ({
    uri: uriFor(o.file),
    range: { start: { line: o.line - 1, character: o.column - 1 }, end: { line: o.endLine - 1, character: o.endColumn - 1 } },
  })

  /** Resolve the request's occurrences, then `answer(lookup, occs)` (sync when the kept index is fresh). */
  function request(params, answer) {
    const abs = uriToPath(params.textDocument?.uri)
    const pos = params.position
    if (!abs || !pos || typeof pos.line !== 'number' || typeof pos.character !== 'number') return null
    const folder = folderOf(abs)
    if (!folder) return null
    const run = (entry) => {
      if (!entry || entry.substituted.has(abs)) return null
      // (an index from the worker: the document may have changed again while it was built)
      const text = overlaysUnder(folder).get(abs)
      if ((text === undefined ? undefined : hashOf(abs, text)) !== entry.hashes.get(abs)) return null
      const occs = entry.lookup.at(abs, pos.line + 1, pos.character + 1)
      if (!occs.length) return null
      return answer(entry.lookup, occs)
    }
    const entry = indexFor(folder)
    return typeof entry?.then === 'function' ? entry.then(run) : run(entry)
  }

  /**
   * The index entry to answer about document `abs` from, under the same freshness rules (code
   * lens, codelens.js): null when none is fresh or the document doesn't parse.
   */
  function entryFor(abs) {
    const folder = abs && folderOf(abs)
    if (!folder) return null
    const fresh = (entry) => {
      if (!entry || entry.substituted.has(abs)) return null
      const text = overlaysUnder(folder).get(abs)
      return (text === undefined ? undefined : hashOf(abs, text)) === entry.hashes.get(abs) ? entry : null
    }
    const entry = indexFor(folder)
    return typeof entry?.then === 'function' ? entry.then(fresh) : fresh(entry)
  }

  function definition(params) {
    return request(params, (lookup, occs) => {
      const list = lookup.definition(occs)
      return list.length ? list.map(location) : null
    })
  }

  function references(params) {
    const includeDeclaration = params.context?.includeDeclaration !== false
    return request(params, (lookup, occs) => lookup.references(occs, includeDeclaration).map(location))
  }

  return { snapshot, accept, track, drop, definition, references, entryFor }
}
