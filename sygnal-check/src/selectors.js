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

/** Parse a hyperscript selector such as 'div.a.b#c' (snabbdom h()). */
export function hyperscriptSel(sel) {
  const classes = []
  const ids = []
  const re = /([.#])([\w-]+)/g
  let m
  while ((m = re.exec(sel))) (m[1] === '.' ? classes : ids).push(m[2])
  return { classes, ids }
}
