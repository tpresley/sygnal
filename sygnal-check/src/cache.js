/**
 * The parse cache (PLAN-7 C-3): reuse a file's parse across builds while its text is identical.
 *
 *   const cache = createParseCache()            // or new ParseCache()
 *   check(['src'], { cache })                   // also checkFiles(), buildProject(), graph(), graphFiles()
 *
 * An entry maps an absolute path to the parse products of one text:
 *   { text, ast, parents: WeakMap<node, parent>, suppressions: Map<line, Set<code> | '*'> }
 * or, for a text Babel can't parse, the failure: { text, error: { message, line, column } }, so
 * a cached unparseable file reports the same SYG900 on every build. Project.loadFile uses an
 * entry when the text it read (from `sources` or the disk) equals entry.text, and replaces it
 * otherwise. Only these products are shared: each build makes its own FileInfo, components and
 * model around them, and no rule or model code writes to an AST.
 *
 * Eviction: a build drops, when it starts, the entries the previous build did not use (a deleted
 * file, a file no longer imported). Use one cache per project (input set); alternating builds of
 * disjoint file sets just re-parse. delete(path) and clear() drop entries by hand.
 *
 * `stats` counts { hits, parses } over the cache's life (parses include failed ones).
 * `freeze: true` deep-freezes every cached AST: a test mode that turns any write to a shared AST
 * into a TypeError (rules run in strict-mode ESM).
 */
export class ParseCache {
  constructor({ freeze = false } = {}) {
    this.freeze = !!freeze
    this.stats = { hits: 0, parses: 0 }
    this._entries = new Map() // absPath → entry
    this._used = new Set() // paths used since the current build started
  }

  get size() { return this._entries.size }
  has(absPath) { return this._entries.has(absPath) }
  get(absPath) { return this._entries.get(absPath) }
  keys() { return this._entries.keys() }
  delete(absPath) { return this._entries.delete(absPath) }
  clear() { this._entries.clear() }

  /** The entry for `absPath` when its text is `text` (counted as a hit), else undefined. */
  lookup(absPath, text) {
    this._used.add(absPath)
    const e = this._entries.get(absPath)
    if (e && e.text === text) { this.stats.hits++; return e }
    return undefined
  }

  /** Store a fresh parse (or failure) of `absPath`. */
  store(absPath, entry) {
    this._used.add(absPath)
    this.stats.parses++
    if (this.freeze && entry.ast) deepFreeze(entry.ast)
    this._entries.set(absPath, entry)
    return entry
  }

  /** Called by Project.build(): drop what the previous build didn't use, start a new build. */
  beginBuild() {
    for (const p of [...this._entries.keys()]) if (!this._used.has(p)) this._entries.delete(p)
    this._used = new Set()
  }
}

export function createParseCache(options) {
  return new ParseCache(options)
}

function deepFreeze(root) {
  const stack = [root]
  const seen = new Set()
  while (stack.length) {
    const v = stack.pop()
    if (!v || typeof v !== 'object' || seen.has(v)) continue
    seen.add(v)
    Object.freeze(v)
    for (const k of Object.keys(v)) stack.push(v[k])
  }
}
