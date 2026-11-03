/**
 * SYG458 (7.2): a declaration static reads a context field off its bag.
 *
 * Since 7.2 the second argument of `resources`, `timers`, `connections`, `head`, `browser` and
 * `route` (the static itself, or each function of an object value) is the bag the view gets:
 * `{ ...props, state, context, uid }`. Until 8.0 the context's own fields are on it too (the
 * bag's own keys win), so `(s, { route }) => …` still works; the dev entry warns (SYG458) and
 * 8.0 removes them. The canonical form is `(s, { context: { route } }) => …`.
 *
 * Reported for a top-level key of the parameter's object pattern (`(s, { route })`), or a member
 * read off a plain parameter (`(s, b) => b.route`, `const { route } = b`), that names a context
 * key some scanned component's `.context` declares. `state`, `context` and `uid` are the bag's own.
 * A key no `.context` declares is taken for a prop and never reported. When the component also
 * takes a prop of that name (its view destructures it, or a usage passes it), the message says
 * the prop wins.
 *
 * --fix (the pattern form only): moves the keys into a `context: { … }` entry at the first one's
 * place (`(s, { id, route })` → `(s, { id, context: { route } })`), or into the pattern's
 * existing `context: { … }`. No fix with a rest element, or a `context` entry that is not an
 * object pattern.
 */
import { walk, unwrap, propName, memberName, stringValue } from '../ast.js'
import { staticFunctions, declaredContextKeys, BAG_KEYS } from '../model/context.js'
import { renderedUsages } from '../model/usages.js'

/** The props a component takes, as far as the checker sees: its view's pattern and its usages' attributes. */
function propsOf(project, comp) {
  const out = new Set()
  let p = comp.view?.params?.[0]
  if (p?.type === 'AssignmentPattern') p = p.left
  if (p?.type === 'ObjectPattern') {
    for (const q of p.properties) {
      const k = q.type === 'ObjectProperty' ? propName(q) : null
      if (k && !BAG_KEYS.has(k)) out.add(k)
    }
  }
  if (comp.view) {
    for (const { usage } of renderedUsages(project)) {
      if (usage.ref?.node !== comp.view || usage.node?.type !== 'JSXOpeningElement') continue
      for (const a of usage.node.attributes) if (a.type === 'JSXAttribute' && a.name.type === 'JSXIdentifier') out.add(a.name.name)
    }
  }
  return out
}

/** The text of a pattern's `{ … }` (without a TS type annotation). */
function patternEnd(src, pat) {
  let end = pat.typeAnnotation ? pat.typeAnnotation.start : pat.end
  while (end > pat.start && src[end - 1] !== '}') end--
  return end
}

/** The --fix edit for an object pattern, or null. */
function patternFix(file, pat, moved) {
  const src = file.source
  if (pat.properties.some(p => p.type === 'RestElement')) return null
  const text = (n) => src.slice(n.start, n.end)
  const ctx = pat.properties.find(p => p.type === 'ObjectProperty' && propName(p) === 'context')
  let inner = null // the existing context: { … } pattern
  if (ctx) {
    inner = ctx.value.type === 'AssignmentPattern' ? ctx.value.left : ctx.value
    if (inner.type !== 'ObjectPattern' || inner.properties.some(p => p.type === 'RestElement')) return null
  }
  const movedSet = new Set(moved)
  const movedText = moved.map(text)
  const parts = []
  for (const p of pat.properties) {
    if (movedSet.has(p)) {
      if (!ctx && p === moved[0]) parts.push(`context: { ${movedText.join(', ')} }`)
      continue
    }
    if (p === ctx) {
      const all = [...inner.properties.map(text), ...movedText].join(', ')
      parts.push(text(ctx).slice(0, inner.start - ctx.start) + `{ ${all} }` + text(ctx).slice(inner.end - ctx.start))
      continue
    }
    parts.push(text(p))
  }
  return { file: file.path, start: pat.start, end: patternEnd(src, pat), text: `{ ${parts.join(', ')} }` }
}

export default {
  id: 'bag-context-field',
  codes: ['SYG458'],
  description: 'Declaration static reads a context field off its bag',
  run(project, report) {
    const ctxKeys = declaredContextKeys(project)
    if (!ctxKeys.size) return
    for (const comp of project.components) {
      const fns = staticFunctions(project, comp.file, comp.staticProps)
      if (!fns.length) continue
      let props = null
      const propNote = (keys) => {
        props ??= propsOf(project, comp)
        const both = keys.filter(k => props.has(k))
        return both.length
          ? `; ${comp.name} also takes a prop ${both.map(k => `'${k}'`).join(', ')}, which the bag's own key wins over: this reads the prop, not the context field`
          : ''
      }
      for (const { path, file, node: fn } of fns) {
        let param = fn.params?.[1]
        if (param?.type === 'AssignmentPattern') param = param.left
        if (!param) continue
        const where = `${comp.name}.${path}`
        if (param.type === 'ObjectPattern') {
          const moved = param.properties.filter(p => {
            if (p.type !== 'ObjectProperty' || p.computed && !stringValue(p.key)) return false
            const k = propName(p)
            return k && !BAG_KEYS.has(k) && ctxKeys.has(k)
          })
          if (!moved.length) continue
          const keys = moved.map(propName)
          const edit = patternFix(file, param, moved)
          const shown = keys.join(', ')
          report({
            code: 'SYG458',
            component: comp.name,
            file,
            node: moved[0].key,
            endNode: moved[moved.length - 1],
            message: `${where} reads the context field${keys.length > 1 ? 's' : ''} ${keys.map(k => `'${k}'`).join(', ')} off its second argument, the bag (7.2: { ...props, state, context, uid }); the context's fields are on the bag only until 8.0` + propNote(keys),
            fix: `read ${keys.length > 1 ? 'them' : 'it'} from the bag's context: (state, { context: { ${shown} } }) => …`,
            data: { static: path, keys },
            fixes: edit ? [{ title: `Read ${shown} from the bag's context`, kind: 'quickfix', preferred: true, fixAll: true, edits: [edit] }] : undefined,
          })
          continue
        }
        if (param.type !== 'Identifier') continue
        const name = param.name
        const isBag = (n) => { n = unwrap(n); return n?.type === 'Identifier' && n.name === name }
        const hit = (key, node) => {
          if (!key || BAG_KEYS.has(key) || !ctxKeys.has(key)) return
          report({
            code: 'SYG458',
            component: comp.name,
            file,
            node,
            message: `${where} reads the context field '${key}' off its second argument, the bag (7.2: { ...props, state, context, uid }); the context's fields are on the bag only until 8.0` + propNote([key]),
            fix: `read it from the bag's context: ${name}.context.${key}`,
            data: { static: path, keys: [key] },
          })
        }
        walk(fn.body, (n) => {
          if ((n.type === 'MemberExpression' || n.type === 'OptionalMemberExpression') && isBag(n.object)) {
            hit(memberName(n) ?? (n.computed ? stringValue(n.property) : null), n.property)
          } else if (n.type === 'VariableDeclarator' && n.id.type === 'ObjectPattern' && isBag(n.init)) {
            for (const p of n.id.properties) if (p.type === 'ObjectProperty') hit(propName(p), p.key)
          }
          return true
        })
      }
    }
  },
}
