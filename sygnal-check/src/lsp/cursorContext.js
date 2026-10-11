/**
 * The completion cursor context (PLAN-7 N-2 completions, P4-1; spike 0-S3 §3): what Sygnal
 * name, if any, the cursor of a document is typing, from the document's current text alone. Pure;
 * the main thread (completion.js) decides which component it belongs to from the completion index.
 *
 *   cursorContext(text, offset, file) → { strategy, repair?, context }
 *
 * The strategy chain (0-S3 measured Babel's errorRecovery at 0% on the syntax errors a user makes
 * while typing):
 *   'parse'   the text parses as it is (parseSource, with errorRecovery);
 *   'repair'  it parses with a repair suffix inserted at the cursor: the open string closed, then
 *             `)`, `),`, `}` ... after it, or `: 0,` / `0,` / ` }` after a key, or everything
 *             left open closed (`repair` names the suffix);
 *   'line'    nothing parses: the text before the cursor on its line is classified with regexes
 *             (the caller pairs it with the last good analysis: the index's regions);
 *   null      the cursor is in a comment, or no strategy found a context.
 *
 * Contexts (`context`, null when the cursor isn't at one). Offsets are into `text` (a repair
 * suffix is never in them):
 *   { kind: 'key', token, objects, fresh }
 *       an object key being typed (an identifier or a quoted key, or an empty slot after `{` or
 *       `,`); `objects`: the [start, end] of the enclosing object literals, innermost first (null
 *       for 'line': the caller decides from the region's value ranges); `fresh`: no `:` follows
 *       the key yet
 *   { kind: 'selector' | 'events' | 'emit' | 'next' | 'from' | 'value', token, key? }
 *       a string's contents: the first argument of DOM.select(…) / DOM.<event>(…) ('selector'),
 *       of EVENTS.select(…) ('events'), of event(…) / emit(…) ('emit'), of next(…) ('next'); a
 *       `from` attribute ('from', a Collection's: `from="…"` or `from={'…'}`); the value of a
 *       property `key: '…'` ('value': ok, error, action ...)
 *   token: { start, end, text, quote? }  the key or the string contents being replaced (`end`
 *       reaches over what follows the cursor up to the closing quote, or over a word when the
 *       string is unterminated); text = text.slice(start, offset)
 */
import { parseSource, childNodes, unwrap, propName, memberName, isFunction, jsxName } from '../ast.js'
import { sourceAliases, isSourceRef, domChain, DOM_SOURCE_METHODS } from '../model/intent.js'

const COLLECTIONS = new Set(['Collection', 'collection', 'VirtualCollection'])
const QUOTES = new Set(["'", '"', '`'])
const AFTER_QUOTE = ['', ')', '),', ',', '}', ' />', '>', ');']
const AFTER_KEY = [': 0,', '0,', ' }', ',', ')', '),', '0', ': 0', '}']

/** The string state at the end of `prefix` (naive: no regex literals, no JSX text): the open quote or null. */
function openQuote(prefix) {
  let q = null
  for (let i = 0; i < prefix.length; i++) {
    const ch = prefix[i]
    if (q) { if (ch === '\\') i++; else if (ch === q) q = null; else if (ch === '\n' && q !== '`') q = null; continue }
    if (ch === '/' && prefix[i + 1] === '/') { const j = prefix.indexOf('\n', i); if (j < 0) return null; i = j; continue }
    if (ch === '/' && prefix[i + 1] === '*') { const j = prefix.indexOf('*/', i + 2); if (j < 0) return null; i = j + 1; continue }
    if (QUOTES.has(ch)) q = ch
  }
  return q
}

/** Close what `prefix` left open: the string, then the brackets (0-S3's closeAll). */
export function closeAll(prefix) {
  const stack = []
  let q = null
  for (let i = 0; i < prefix.length; i++) {
    const ch = prefix[i]
    if (q) { if (ch === '\\') i++; else if (ch === q) q = null; continue }
    if (ch === '/' && prefix[i + 1] === '/') { const j = prefix.indexOf('\n', i); if (j < 0) break; i = j; continue }
    if (ch === '/' && prefix[i + 1] === '*') { const j = prefix.indexOf('*/', i + 2); if (j < 0) break; i = j + 1; continue }
    if (QUOTES.has(ch)) q = ch
    else if ('({['.includes(ch)) stack.push(ch)
    else if (')}]'.includes(ch)) stack.pop()
  }
  const close = { '(': ')', '{': '}', '[': ']' }
  let out = q || ''
  if (!q && /[:,]\s*$/.test(prefix)) out += '0'
  return out + stack.reverse().map(c => close[c]).join('')
}

/** The repair suffixes to try at the cursor, most likely first. */
export function repairs(prefix) {
  const q = openQuote(prefix.slice(prefix.lastIndexOf('\n', prefix.length - 1) + 1)) || (openQuote(prefix) === '`' ? '`' : null)
  const list = q ? AFTER_QUOTE.map(s => q + s) : [...AFTER_KEY]
  const all = closeAll(prefix)
  if (all && !list.includes(all)) list.push(all)
  return list
}

/** Where a string's contents end: its closing quote on this line, else the end of the word at the cursor. */
function contentEnd(text, offset, quote) {
  let j = offset
  while (j < text.length && text[j] !== quote && text[j] !== '\n' && text[j] !== '\\') j++
  if (text[j] === quote) return j
  const m = /^[\w$.#|:-]*/.exec(text.slice(offset))
  return offset + m[0].length
}

const wordEnd = (text, offset) => offset + /^[\w$]*/.exec(text.slice(offset))[0].length

/** The nodes from the Program down to the innermost one at `offset`. */
function pathAt(ast, offset) {
  const path = [ast.program]
  let node = ast.program
  for (;;) {
    let strict = null, ending = null, starting = null
    for (const c of childNodes(node)) {
      if (typeof c.start !== 'number' || c.start > offset || c.end < offset) continue
      if (c.start < offset && offset < c.end) { strict = c; break }
      if (c.end === offset) { if (!ending) ending = c } // the first: a shorthand property's key, not its value
      else if (!starting) starting = c
    }
    const next = strict || ending || starting
    if (!next) return path
    path.push(next)
    node = next
  }
}

/** Source aliases visible at the cursor: every enclosing function's, plus DOM and EVENTS by name. */
function aliasesOn(path) {
  const aliases = new Map([['DOM', new Set(['DOM'])], ['EVENTS', new Set(['EVENTS'])]])
  let sourcesParam = null
  const nextNames = new Set(['next'])
  for (const n of path) {
    if (!isFunction(n)) continue
    const sa = sourceAliases(n)
    for (const [k, v] of sa.aliases) {
      if (!aliases.has(k)) aliases.set(k, new Set())
      for (const x of v) aliases.get(k).add(x)
    }
    sourcesParam = sa.sourcesParam || sourcesParam
    if (n.params.length >= 3 && n.params[2].type === 'Identifier') nextNames.add(n.params[2].name)
  }
  return { sa: { aliases, sourcesParam }, nextNames }
}

/** Classify the call whose first argument the cursor's string is. */
function callKind(call, path) {
  const callee = unwrap(call.callee)
  const { sa, nextNames } = aliasesOn(path)
  if (callee.type === 'MemberExpression') {
    const m = memberName(callee)
    if (!m) return null
    const obj = unwrap(callee.object)
    if (m === 'select' && (isSourceRef(obj, 'EVENTS', sa) || (obj.type === 'MemberExpression' && memberName(obj) === 'EVENTS'))) return 'events'
    const chain = domChain(obj, sa)
    if (chain && (m === 'select' || (chain.root && !DOM_SOURCE_METHODS.has(m)))) return 'selector'
    return null
  }
  if (callee.type === 'Identifier') {
    if (nextNames.has(callee.name)) return 'next'
    if (callee.name === 'event' || callee.name === 'emit') return 'emit'
  }
  return null
}

const skipWrappers = (path, i) => {
  let j = i - 1
  while (j >= 0 && unwrap(path[j]) !== path[j]) j--
  return j
}

/** The context at `offset` in a parsed text. */
function classify(ast, text, offset) {
  if ((ast.comments || []).some(c => c.start < offset && offset < c.end)) return null
  const path = pathAt(ast, offset)
  if (path[path.length - 1].type === 'TemplateElement') path.pop()
  const n = path[path.length - 1]
  const parent = path[path.length - 2]
  const objectsOf = (upto) => path.slice(0, upto).filter(x => x.type === 'ObjectExpression').map(o => [o.start, o.end]).reverse()

  const isString = n.type === 'StringLiteral' || (n.type === 'TemplateLiteral' && n.expressions.length === 0)
  if (isString && n.start < offset && offset < n.end) {
    const quote = text[n.start]
    const token = { start: n.start + 1, end: contentEnd(text, offset, quote), quote }
    token.text = text.slice(token.start, offset)
    const pi = skipWrappers(path, path.length - 1)
    const p = path[pi]
    if (!p) return null
    if (p.type === 'CallExpression' && unwrap(p.arguments[0]) === n) {
      const kind = callKind(p, path.slice(0, pi + 1))
      return kind ? { kind, token } : null
    }
    if (p.type === 'ObjectProperty' && !p.computed && p.key === n) {
      return { kind: 'key', token, objects: objectsOf(pi), fresh: !/^\s*:/.test(text.slice(token.end + 1)) }
    }
    if (p.type === 'ObjectProperty' && unwrap(p.value) === n) {
      const key = propName(p)
      return key ? { kind: 'value', key, token } : null
    }
    let attr = p
    if (attr.type === 'JSXExpressionContainer') attr = path[pi - 1]
    if (attr?.type === 'JSXAttribute' && jsxName(attr.name) === 'from') {
      const el = path[path.indexOf(attr) - 1]
      if (el?.type === 'JSXOpeningElement' && COLLECTIONS.has(jsxName(el.name))) return { kind: 'from', token }
    }
    return null
  }
  if (n.type === 'Identifier' && parent?.type === 'ObjectProperty' && !parent.computed && parent.key === n && path[path.length - 3]?.type === 'ObjectExpression') {
    // at the start of an existing key nothing is typed yet: insert before it rather than replace it
    const token = { start: n.start, end: offset === n.start ? offset : Math.max(offset, Math.min(n.end, wordEnd(text, offset))) }
    token.text = text.slice(token.start, offset)
    return { kind: 'key', token, objects: objectsOf(path.length - 2), fresh: !/^\s*:/.test(text.slice(token.end)) }
  }
  if (n.type === 'ObjectExpression' && n.start < offset && offset < n.end) {
    // an empty key slot: right after `{` or `,`
    if (!/[{,]\s*$/.test(text.slice(n.start, offset))) return null
    const inProp = n.properties.some(p => p.start < offset && offset < p.end)
    if (inProp) return null
    return { kind: 'key', token: { start: offset, end: offset, text: '' }, objects: objectsOf(path.length), fresh: true }
  }
  return null
}

const LINE_STRINGS = [
  [/\bnext\(\s*(['"`])([^'"`]*)$/, 'next'],
  [/\b(?:event|emit)\(\s*(['"`])([^'"`]*)$/, 'emit'],
  [/\bEVENTS\b.*\.select\(\s*(['"`])([^'"`]*)$/, 'events'],
  [/\bDOM\b.*\.(?!events\b|elements?\b)[\w$]+\(\s*(['"`])([^'"`]*)$/, 'selector'],
  [/\.select\(\s*(['"`])([^'"`]*)$/, 'selector'],
  [/\bfrom=(["'])([^"']*)$/, 'from'],
  [/\bfrom=\{\s*(['"`])([^'"`]*)$/, 'from'],
]
const LINE_VALUE = /\b([A-Za-z_$][\w$]*)\s*:\s*(['"`])([^'"`]*)$/
const LINE_KEY = /(?:^|[{,])\s*(['"]?)([A-Za-z_$][\w$.]*)?$/

/** 0-S3's approach C: the text before the cursor on its line. */
export function classifyLine(text, offset) {
  const lineStart = text.lastIndexOf('\n', offset - 1) + 1
  const prefix = text.slice(lineStart, offset)
  if (/^\s*(\/\/|\*|\/\*)/.test(prefix)) return null
  const str = (quote, contents) => {
    const token = { start: offset - contents.length, end: contentEnd(text, offset, quote), quote }
    token.text = contents
    return token
  }
  for (const [re, kind] of LINE_STRINGS) {
    const m = re.exec(prefix)
    if (m) return { kind, token: str(m[1], m[2]) }
  }
  const v = LINE_VALUE.exec(prefix)
  if (v) return { kind: 'value', key: v[1], token: str(v[2], v[3]) }
  const k = LINE_KEY.exec(prefix)
  if (k) {
    const word = k[2] || ''
    const start = offset - word.length
    const token = k[1]
      ? { start, end: contentEnd(text, offset, k[1]), quote: k[1], text: word }
      : { start, end: wordEnd(text, offset), text: word }
    return { kind: 'key', token, objects: null, fresh: !/^\s*:/.test(text.slice(token.end + (k[1] && text[token.end] === k[1] ? 1 : 0))) }
  }
  return null
}

const tryParse = (text, file) => { try { return parseSource(text, file) } catch { return null } }

export function cursorContext(text, offset, file) {
  offset = Math.max(0, Math.min(offset, text.length))
  const ast = tryParse(text, file)
  if (ast) return { strategy: 'parse', context: classify(ast, text, offset) }
  const prefix = text.slice(0, offset)
  const rest = text.slice(offset)
  for (const suffix of repairs(prefix)) {
    const repaired = tryParse(prefix + suffix + rest, file)
    if (!repaired) continue
    const context = classify(repaired, prefix + suffix + rest, offset)
    if (context) unshift(context, offset, suffix.length, text)
    return { strategy: 'repair', repair: suffix, context }
  }
  const context = classifyLine(text, offset)
  return { strategy: context ? 'line' : null, context }
}

/** Map a context found in the repaired text back to the original text (drop the suffix). */
function unshift(ctx, offset, len, text) {
  const back = (x) => x > offset ? Math.max(offset, x - len) : x
  if (ctx.objects) ctx.objects = ctx.objects.map(([s, e]) => [back(s), back(e)])
  // the token's end was measured on the repaired text: re-measure on the original
  if (ctx.token && ctx.token.end > offset) {
    ctx.token.end = ctx.token.quote ? contentEnd(text, offset, ctx.token.quote) : wordEnd(text, offset)
  }
  if (ctx.kind === 'key') ctx.fresh = !/^\s*:/.test(text.slice(ctx.token.end + (ctx.token.quote && text[ctx.token.end] === ctx.token.quote ? 1 : 0)))
}
