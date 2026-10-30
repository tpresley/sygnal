/**
 * The CSS selector subset intents use (and controls stringify to): `a, b`, descendant and `>`
 * combinators, and compounds of tag, #id, .class, [attr], [attr="v"], :focus. Enough for every
 * selector in examples/todomvc and the docs' canonical forms; anything else throws (loudly, so a
 * renderer gap shows up as an error, not as a stream that never fires).
 */
type Simple = {tag?: string, id?: string, classes: string[], attrs: [string, string | undefined][], focus?: boolean}
type Step = {comb: ' ' | '>', simple: Simple}

const cache = new Map<string, Step[][]>()

function parseCompound(s: string): Simple {
  const out: Simple = {classes: [], attrs: []}
  const re = /^([a-zA-Z][\w-]*|\*)|#([\w-]+)|\.([\w-]+)|\[([\w-]+)(?:=(?:"([^"]*)"|'([^']*)'|([^\]]*)))?\]|:(focus)/g
  let m: RegExpExecArray | null, used = 0
  while ((m = re.exec(s)) && m[0]) {
    if (m.index !== used) break
    used += m[0].length
    if (m[1]) out.tag = m[1] == '*' ? undefined : m[1].toLowerCase()
    else if (m[2]) out.id = m[2]
    else if (m[3]) out.classes.push(m[3])
    else if (m[4]) out.attrs.push([m[4], m[5] ?? m[6] ?? m[7]])
    else if (m[8]) out.focus = true
  }
  if (used !== s.length) throw new Error(`host selector: unsupported selector part "${s.slice(used)}" in "${s}"`)
  return out
}

export function parse(sel: string): Step[][] {
  let r = cache.get(sel)
  if (r) return r
  r = sel.split(',').map(part => {
    const steps: Step[] = []
    const toks = part.trim().replace(/\s*>\s*/g, ' > ').split(/\s+/).filter(Boolean)
    let comb: ' ' | '>' = ' '
    for (const t of toks) {
      if (t == '>') { comb = '>'; continue }
      steps.push({comb, simple: parseCompound(t)})
      comb = ' '
    }
    return steps
  })
  cache.set(sel, r)
  return r
}

function matchSimple(el: any, s: Simple): boolean {
  if (s.tag && el.localName !== s.tag) return false
  if (s.id && el.id !== s.id) return false
  for (const c of s.classes) if (!el.classList.contains(c)) return false
  for (const [a, v] of s.attrs) {
    const has = el.getAttribute(a)
    if (has === null) return false
    if (v !== undefined && has !== v) return false
  }
  if (s.focus && el.ownerDocument.activeElement !== el) return false
  return true
}

/** right to left; `stop`: an ancestor the match may not reach past (a scope's root's parent) */
function matchSteps(el: any, steps: Step[], i: number, stop: any): boolean {
  if (!matchSimple(el, steps[i].simple)) return false
  if (i === 0) return true
  const comb = steps[i].comb
  for (let p = el.parentNode; p && p !== stop; p = p.parentNode) {
    if (p.nodeType === 1 && matchSteps(p, steps, i - 1, stop)) return true
    if (comb === '>') return false
  }
  return false
}

export function matches(el: any, sel: string, stop: any = null): boolean {
  return parse(sel).some(steps => matchSteps(el, steps, steps.length - 1, stop))
}

export function querySelectorAll(root: any, sel: string): any[] {
  const out: any[] = []
  const walk = (n: any) => {
    for (const c of n.childNodes) if (c.nodeType === 1) { if (matches(c, sel, root)) out.push(c); walk(c) }
  }
  walk(root)
  return out
}
