/**
 * Extract the class and id names a CSS selector requires.
 *
 * '.a .b, #c'      → [{ kind: 'class', name: 'a' }, { kind: 'class', name: 'b' }, { kind: 'id', name: 'c' }]
 * 'li:not(.done)'  → []           (negations don't require the class)
 * '[data-x=".y"]'  → []           (attribute contents are skipped)
 */

// Selectors that address something outside the component's own DOM.
export const GLOBAL_SELECTORS = new Set(['document', 'body', 'window', ':root', 'html', '*', ''])

function stripNested(sel) {
  let out = ''
  let i = 0
  while (i < sel.length) {
    const ch = sel[i]
    if (ch === '\\') { out += sel.slice(i, i + 2); i += 2; continue }
    if (ch === '[') {
      const end = sel.indexOf(']', i)
      i = end === -1 ? sel.length : end + 1
      out += ' '
      continue
    }
    if (ch === '"' || ch === "'") {
      const end = sel.indexOf(ch, i + 1)
      i = end === -1 ? sel.length : end + 1
      continue
    }
    if (ch === ':' ) {
      // :not(...) / :is(...) / :has(...) / :nth-child(...) — drop the argument.
      // (:is/:where/:has contents are optional or relational, so not required)
      const m = /^::?[\w-]+/.exec(sel.slice(i))
      const name = m ? m[0] : ':'
      i += name.length
      if (sel[i] === '(') {
        let depth = 0
        for (; i < sel.length; i++) {
          if (sel[i] === '(') depth++
          else if (sel[i] === ')' && --depth === 0) { i++; break }
        }
      }
      out += ' '
      continue
    }
    out += ch
    i++
  }
  return out
}

export function selectorRequirements(selector) {
  const trimmed = selector.trim()
  if (GLOBAL_SELECTORS.has(trimmed)) return []
  const out = []
  const seen = new Set()
  const stripped = stripNested(trimmed)
  const re = /([.#])((?:\\.|[\w-])+)/g
  let m
  while ((m = re.exec(stripped))) {
    const kind = m[1] === '.' ? 'class' : 'id'
    const name = m[2].replace(/\\(.)/g, '$1')
    const key = kind + ':' + name
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ kind, name })
  }
  return out
}

// The pseudo-classes and pseudo-elements browsers parse. A vendor-prefixed name (`:-moz-x`,
// `::-webkit-x`) is never reported
const PSEUDO_CLASSES = new Set([
  'active', 'active-view-transition', 'active-view-transition-type', 'any-link', 'autofill', 'blank', 'buffering',
  'checked', 'current', 'default', 'defined', 'dir', 'disabled', 'empty', 'enabled', 'first', 'first-child',
  'first-of-type', 'focus', 'focus-visible', 'focus-within', 'fullscreen', 'future', 'has', 'has-slotted', 'host',
  'host-context', 'hover', 'in-range', 'indeterminate', 'interest-source', 'interest-target', 'invalid', 'is', 'lang',
  'last-child', 'last-of-type', 'left', 'link', 'local-link', 'modal', 'muted', 'not', 'nth-child', 'nth-col',
  'nth-last-child', 'nth-last-col', 'nth-last-of-type', 'nth-of-type', 'only-child', 'only-of-type', 'open', 'optional',
  'out-of-range', 'past', 'paused', 'picture-in-picture', 'placeholder-shown', 'playing', 'popover-open', 'read-only',
  'read-write', 'required', 'right', 'root', 'scope', 'seeking', 'stalled', 'state', 'target', 'target-current',
  'target-within', 'user-invalid', 'user-valid', 'valid', 'visited', 'volume-locked', 'where', 'xr-overlay',
  // the pseudo-elements that also parse with one colon
  'after', 'before', 'first-letter', 'first-line',
])
const PSEUDO_ELEMENTS = new Set([
  'after', 'backdrop', 'before', 'checkmark', 'column', 'cue', 'cue-region', 'details-content', 'file-selector-button',
  'first-letter', 'first-line', 'grammar-error', 'highlight', 'marker', 'part', 'picker', 'picker-icon', 'placeholder',
  'scroll-button', 'scroll-marker', 'scroll-marker-group', 'search-text', 'selection', 'slotted', 'spelling-error',
  'target-text', 'view-transition', 'view-transition-group', 'view-transition-image-pair', 'view-transition-new',
  'view-transition-old',
])
// (:is and :where take a forgiving list: what's inside never throws)
const CHECKED_ARGS = new Set(['not', 'has'])
const NEEDS_ARGS = new Set(['not', 'is', 'where', 'has', 'nth-child', 'nth-last-child', 'nth-of-type', 'nth-last-of-type', 'nth-col', 'nth-last-col', 'lang', 'dir', 'state', 'host-context'])

const NAME = String.raw`(?:[\w\u0080-￿-]|\\[\s\S])`
const IDENT = String.raw`(?:--|-?(?:[a-zA-Z_\u0080-￿]|\\[\s\S]))${NAME}*`
const STRING = String.raw`"(?:[^"\\]|\\[\s\S])*"|'(?:[^'\\]|\\[\s\S])*'`
const ATTRIBUTE = new RegExp(String.raw`^\s*(?:(?:${IDENT}|\*)?\|(?!=))?${IDENT}\s*(?:[~|^$*]?=\s*(?:${IDENT}|${STRING})\s*[iIsS]?\s*)?$`)

// end of the identifier at `i` (past escapes; a hex escape keeps its one optional space), and
// `error` when there is none there: 'digit', or 'empty'
function readIdent(s, i) {
  const start = i
  if (s[i] === '-' && s[i + 1] !== '-') i++
  if (/[0-9]/.test(s[i] || '')) return { end: i, error: 'digit' }
  const nameStart = i
  while (i < s.length) {
    if (s[i] === '\\' && i + 1 < s.length) {
      const hex = /^[0-9a-fA-F]{1,6}\s?/.exec(s.slice(i + 1, i + 8))
      i += 1 + (hex ? hex[0].length : 1)
    } else if (/[\w-]/.test(s[i]) || s[i] > '\x7f') i++
    else break
  }
  return i === nameStart ? { end: start, error: 'empty' } : { end: i }
}

// index of the `close` matching the `open` at `i` (strings and escapes skipped), or -1
function closingIndex(s, i, open, close) {
  let depth = 0
  for (; i < s.length; i++) {
    const c = s[i]
    if (c === '\\') i++
    else if (c === '"' || c === "'") {
      for (i++; i < s.length && s[i] !== c; i++) if (s[i] === '\\') i++
    } else if (c === open) depth++
    else if (c === close && --depth === 0) return i
  }
  return -1
}

function scanPseudo(s, i) {
  const colons = s[i + 1] === ':' ? 2 : 1
  const id = readIdent(s, i + colons)
  if (id.error) return { problem: `'${':'.repeat(colons)}' must be followed by a ${colons === 2 ? 'pseudo-element' : 'pseudo-class'} name` }
  const raw = s.slice(i + colons, id.end)
  const name = raw.toLowerCase()
  const shown = ':'.repeat(colons) + raw
  if (!name.startsWith('-') && !(colons === 2 ? PSEUDO_ELEMENTS : PSEUDO_CLASSES).has(name)) {
    return { problem: `${shown} is not a CSS ${colons === 2 ? 'pseudo-element' : 'pseudo-class'}` }
  }
  if (s[id.end] !== '(') return NEEDS_ARGS.has(name) ? { problem: `${shown} needs arguments in parentheses` } : { end: id.end }
  // (a block left open at the end of the selector is closed by the CSS parser: `:not(.a` is valid)
  if (CHECKED_ARGS.has(name)) {
    const r = scanList(s, id.end + 1, true)
    return r.problem ? r : { end: r.end + 1 }
  }
  const close = closingIndex(s, id.end, '(', ')')
  return { end: close === -1 ? s.length : close + 1 }
}

function scanList(s, i, nested) {
  while (i < s.length) {
    const c = s[i]
    if (c === ')') return nested ? { end: i } : { problem: "unexpected ')'" }
    if (/[\s,>+~*&|]/.test(c)) { i++; continue }
    if (c === '.' || c === '#') {
      const id = readIdent(s, i + 1)
      if (id.error === 'digit') return { problem: `${c === '.' ? 'a class' : 'an id'} can't start with a digit unless the digit is escaped` }
      if (id.error) return { problem: `'${c}' must be followed by a name` }
      i = id.end
    } else if (c === '[') {
      const close = closingIndex(s, i, '[', ']')
      const body = s.slice(i + 1, close === -1 ? s.length : close)
      if (!ATTRIBUTE.test(body)) return { problem: close === -1 ? "the '[' is never closed" : `${s.slice(i, close + 1)} is not a valid attribute selector` }
      i = close === -1 ? s.length : close + 1
    } else if (c === ':') {
      const r = scanPseudo(s, i)
      if (r.problem) return r
      i = r.end
    } else {
      const id = readIdent(s, i)
      if (id.error === 'digit') return { problem: `'${c}' can't start a name unless it is escaped` }
      if (id.error) return { problem: `'${c}' can't appear in a selector unless it is escaped` }
      i = id.end
    }
  }
  return { end: i }
}

/**
 * Why `selector` is not a CSS selector the browser can parse (`matches()` would throw a
 * SyntaxError), as a short phrase, or null when it is valid. Conservative: only what is
 * certainly invalid is reported (a stray combinator or comma is left to the browser).
 */
export function selectorProblem(selector) {
  const s = selector.trim()
  if (GLOBAL_SELECTORS.has(s)) return null
  return scanList(s, 0, false).problem || null
}

/** Parse a hyperscript selector such as 'div.a.b#c' (snabbdom h()). */
export function hyperscriptSel(sel) {
  const classes = []
  const ids = []
  const re = /([.#])([\w-]+)/g
  let m
  while ((m = re.exec(sel))) (m[1] === '.' ? classes : ids).push(m[2])
  return { classes, ids }
}

/**
 * PLAN-7 N-1: where each class / id token of a selector is, as selectorRequirements() reads it
 * (the same names, every occurrence: '.a .b, .a' gives three), or of a hyperscript selector
 * (`hyperscript: true`, as hyperscriptSel() reads it).
 *   → Array<{ kind: 'class' | 'id', name, index, length }>   index/length: of the name, in `selector`
 */
export function selectorTokens(selector, { hyperscript = false } = {}) {
  const out = []
  if (hyperscript) {
    const re = /([.#])([\w-]+)/g
    let m
    while ((m = re.exec(selector))) out.push({ kind: m[1] === '.' ? 'class' : 'id', name: m[2], index: m.index + 1, length: m[2].length })
    return out
  }
  if (GLOBAL_SELECTORS.has(selector.trim())) return out
  const blanked = blankNested(selector)
  const re = /([.#])((?:\\.|[\w-])+)/g
  let m
  while ((m = re.exec(blanked))) {
    out.push({ kind: m[1] === '.' ? 'class' : 'id', name: m[2].replace(/\\(.)/g, '$1'), index: m.index + 1, length: m[2].length })
  }
  return out
}

/** stripNested() with every dropped character replaced by a space (offsets kept). */
function blankNested(sel) {
  const chars = sel.split('')
  const blank = (from, to) => { for (let k = from; k < to && k < chars.length; k++) chars[k] = ' ' }
  let i = 0
  while (i < sel.length) {
    const ch = sel[i]
    if (ch === '\\') { i += 2; continue }
    if (ch === '[') {
      const end = sel.indexOf(']', i)
      const to = end === -1 ? sel.length : end + 1
      blank(i, to); i = to
      continue
    }
    if (ch === '"' || ch === "'") {
      const end = sel.indexOf(ch, i + 1)
      const to = end === -1 ? sel.length : end + 1
      blank(i, to); i = to
      continue
    }
    if (ch === ':') {
      const m = /^::?[\w-]+/.exec(sel.slice(i))
      let to = i + (m ? m[0].length : 1)
      if (sel[to] === '(') {
        let depth = 0
        for (; to < sel.length; to++) {
          if (sel[to] === '(') depth++
          else if (sel[to] === ')' && --depth === 0) { to++; break }
        }
      }
      blank(i, to); i = to
      continue
    }
    i++
  }
  return chars.join('')
}
