/**
 * sygnal/host: the CSS selector subset intents use, on host elements. Selector lists (`a, b`),
 * the descendant and child (`>`) combinators, and compounds of `*`, tag, #id, .class, [attr],
 * [attr=v] (also ^= $= *= ~=), :focus and :not(<compound>). Controls stringify to
 * `[data-control="X"]`. Anything else throws, so a gap shows as an error rather than as a stream
 * that never fires.
 */
type Attr = [name: string, op: string, value: string | undefined]
type Simple = {tag?: string, id?: string, classes: string[], attrs: Attr[], focus?: boolean, not: Simple[]}
type Step = {comb: ' ' | '>', simple: Simple}

const cache = new Map<string, Step[][]>()
const COMPOUND = /([a-zA-Z][\w-]*|\*)|#([\w-]+)|\.([\w-]+)|\[\s*([\w-]+)\s*(?:([~^$*]?=)\s*(?:"([^"]*)"|'([^']*)'|([^\]\s]*))\s*)?\]|:(focus)|:not\(([^)]*)\)/y

function compound(s: string, sel: string): Simple {
  const out: Simple = {classes: [], attrs: [], not: []}
  let i = 0
  while (i < s.length) {
    COMPOUND.lastIndex = i
    const m = COMPOUND.exec(s)
    if (!m) throw new Error(`sygnal/host: unsupported selector "${sel}" (at "${s.slice(i)}")`)
    // (before a :not() recursion reuses the sticky regex)
    const next = COMPOUND.lastIndex
    if (m[1] && i == 0) out.tag = m[1] == '*' ? undefined : m[1].toLowerCase()
    else if (m[1]) throw new Error(`sygnal/host: unsupported selector "${sel}"`)
    else if (m[2]) out.id = m[2]
    else if (m[3]) out.classes.push(m[3])
    else if (m[4]) out.attrs.push([m[4], m[5] || '', m[6] ?? m[7] ?? m[8]])
    else if (m[9]) out.focus = true
    else if (m[10] !== undefined) out.not.push(compound(m[10].trim(), sel))
    i = next
  }
  return out
}

function parse(sel: string): Step[][] {
  let r = cache.get(sel)
  if (r) return r
  r = sel.split(',').map(part => {
    const steps: Step[] = []
    let comb: ' ' | '>' = ' '
    for (const t of part.trim().replace(/\s*>\s*/g, ' > ').split(/\s+/)) {
      if (!t) continue
      if (t == '>') { comb = '>'; continue }
      steps.push({comb, simple: compound(t, sel)})
      comb = ' '
    }
    if (!steps.length) throw new Error(`sygnal/host: empty selector "${sel}"`)
    return steps
  })
  if (cache.size < 1024) cache.set(sel, r)
  return r
}

function attrOk(el: any, [name, op, v]: Attr): boolean {
  const has = el.getAttribute(name)
  if (has === null) return false
  if (v === undefined) return true
  switch (op) {
    case '=': return has === v
    case '^=': return !!v && has.startsWith(v)
    case '$=': return !!v && has.endsWith(v)
    case '*=': return !!v && has.includes(v)
    default: return has.split(/\s+/).includes(v)
  }
}

function simpleOk(el: any, s: Simple): boolean {
  if (s.tag && el.localName !== s.tag) return false
  if (s.id && el.getAttribute('id') !== s.id) return false
  for (const c of s.classes) if (!el.classList.contains(c)) return false
  for (const a of s.attrs) if (!attrOk(el, a)) return false
  if (s.focus && el.ownerDocument.activeElement !== el) return false
  for (const n of s.not) if (simpleOk(el, n)) return false
  return true
}

/** right to left; `stop`: an ancestor the match may not reach (an isolation scope's boundary) */
function stepsOk(el: any, steps: Step[], i: number, stop: any): boolean {
  if (!simpleOk(el, steps[i].simple)) return false
  if (i === 0) return true
  const child = steps[i].comb === '>'
  for (let p = el.parentNode; p && p !== stop; p = p.parentNode) {
    if (stepsOk(p, steps, i - 1, stop)) return true
    if (child) return false
  }
  return false
}

/** whether `el` matches `sel` without reaching `stop` or above for its ancestor parts */
export function matches(el: any, sel: string, stop: any = null): boolean {
  for (const steps of parse(sel)) if (stepsOk(el, steps, steps.length - 1, stop)) return true
  return false
}

/** the descendants of `root` (not root itself) that match, in document order (as the DOM: ancestor parts may match above root) */
export function querySelectorAll(root: any, sel: string): any[] {
  const out: any[] = []
  const walk = (n: any) => {
    for (const c of n.childNodes) if (c.nodeType === 1) { if (matches(c, sel)) out.push(c); walk(c) }
  }
  walk(root)
  return out
}
