/**
 * `vite build` (client code only): Sygnal's own messages reduced to the code, the component name
 * and the docs URL, the way React's production builds do it, and the per-component debug logging
 * removed. Applied to the core bundle (dist/index.esm.js, the one with the diagnostics bridge).
 *
 *   warn('SYG207', name, `Calculated field '${f}' ...`, 'Rename one of them')  →  warn('SYG207', name, "")
 *   error('SYG406', this, 'View threw', undefined, e)                          →  error('SYG406', this, "", void 0, e)
 *   app.caught(inst, 'SYG408', 'Sub-component threw', e, 'instantiate')        →  app.caught(inst, 'SYG408', "", e, 'instantiate')
 *   dbg(inst, () => `<${type}> Action triggered`)                              →  void 0
 *
 * The bundle's function names carry Rollup's suffixes (`fail$2`), so the functions are found by
 * their shape; a bundle where one isn't found stays as it is. Replacements keep the line count.
 */
const walk = (n: any, f: (n: any) => void): void => {
  if (!n || typeof n !== 'object') return
  if (Array.isArray(n)) { for (const x of n) walk(x, f); return }
  if (typeof n.type === 'string') f(n)
  for (const k in n) walk(n[k], f)
}

const named = (s: string) => new RegExp(`^${s}(\\$\\d+)?$`)

/** The rewritten bundle, or null when `code` isn't one this understands. */
export function shortenMessages(code: string, parse: (code: string) => any): string | null {
  const ast = parse(code)
  const loggers = new Set<string>()
  let dbg: string | undefined
  for (const n of ast.body) {
    if (n.type === 'FunctionDeclaration') {
      if (named('dbg').test(n.id.name)) dbg = n.id.name
      else if (named('fail').test(n.id.name) && code.slice(n.start, n.end).includes('.sygnal')) loggers.add(n.id.name)
    } else if (n.type === 'VariableDeclaration') {
      for (const d of n.declarations) {
        const c = d.init
        if (c?.type === 'CallExpression' && c.callee.type === 'Identifier' && named('emit').test(c.callee.name) && /^(warn|error)$/.test(c.arguments[0]?.value)) loggers.add(d.id.name)
      }
    }
  }
  if (!dbg || loggers.size !== 3) return null

  const edits: Array<[number, number, string]> = []
  const isCode = (a: any) => (a.type === 'Literal' && /^SYG/.test(a.value)) || (a.type === 'Identifier' && a.name === 'code') || (a.type === 'MemberExpression' && a.property.name === 'code')
  walk(ast, n => {
    if (n.type !== 'CallExpression') return
    const a = n.arguments, c = n.callee
    if (c.type === 'Identifier' && c.name === dbg) edits.push([n.start, n.end, 'void 0'])
    else if (c.type === 'Identifier' && loggers.has(c.name) && a.length > 2 && isCode(a[0])) {
      const extra = a.slice(4).map((x: any) => code.slice(x.start, x.end))
      edits.push([a[2].start, a[a.length - 1].end, extra.length ? `"",void 0,${extra.join(',')}` : '""'])
    } else if (c.type === 'MemberExpression' && c.property.name === 'caught' && a.length > 3) edits.push([a[2].start, a[2].end, '""'])
  })

  let out = '', at = 0
  for (const [s, e, t] of edits.sort((x, y) => x[0] - y[0])) {
    if (s < at) continue // inside a replaced call
    out += code.slice(at, s) + t + code.slice(s, e).replace(/[^\n]/g, '')
    at = e
  }
  return out + code.slice(at)
}
