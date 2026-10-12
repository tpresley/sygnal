// PLAN-9 worker B: test notation helpers for the compose.decisions() suites (the research's
// structure/composer.mjs format). The suites run on A's real defineCatalog and layout.ts.

// ---------- the research notation (structure/composer.mjs format/parse) → a Tree ----------
/** 'page(a row(b c) tabs[overview: d | billing: e])' → [{ part: 'a' }, { part: 'row', children: [...] }, ...]; '' → [] */
export function parseTree(text) {
  if (!text.trim()) return []
  const tokens = text.match(/[A-Za-z0-9_]+|[()[\]:|]/g)
  let i = 0
  const node = () => {
    const out = { part: tokens[i++] }
    if (tokens[i] === '(') {
      i++
      out.children = []
      while (tokens[i] !== ')') out.children.push(node())
      i++
    } else if (tokens[i] === '[') {
      i++
      out.children = {}
      while (tokens[i] !== ']') {
        const slot = tokens[i++]
        i++
        const kids = []
        while (tokens[i] !== '|' && tokens[i] !== ']') kids.push(node())
        out.children[slot] = kids
        if (tokens[i] === '|') i++
      }
      i++
    }
    return out
  }
  return node().children
}

/** a Tree → the research notation (for messages) */
export function formatTree(tree) {
  const f = (n) => {
    if (!n.children) return n.part + (n.params ? `{${Object.entries(n.params).map(([k, v]) => `${k}=${v}`).join(',')}}` : '')
    if (Array.isArray(n.children)) return `${n.part}(${n.children.map(f).join(' ')})`
    return `${n.part}[${Object.entries(n.children).map(([s, l]) => `${s}: ${l.map(f).join(' ')}`).join(' | ')}]`
  }
  return `page(${tree.map(f).join(' ')})`
}
