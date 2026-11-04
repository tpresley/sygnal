/**
 * SYG458 (7.2): a declaration static reads a context field off its bag.
 *
 * Since 7.2 the second argument of `resources`, `timers`, `connections`, `head`, `browser` and
 * `route` (the static itself, or each function of an object value) is the bag the view gets:
 * `{ ...props, state, context, uid }`. Until 8.0 the context's own fields are on it too (the
 * bag's own keys win), so `(s, { route }) => …` still works; the dev entry warns (SYG458) and
 * 8.0 removes them. The canonical form is `(s, { context: { route } }) => …`.
 *
 * Reported for a top-level key of the parameter's object pattern (`(s, { route })`), a member
 * read off a plain parameter (`(s, b) => b.route`, `const { route } = b`), or a plain parameter
 * passed to a same-module helper that reads one off its own parameter (`(s, b) => idOf(b)`,
 * followed like SYG102 follows helpers; a helper the checker can't see stays silent), that names
 * a context key some scanned component's `.context` declares. `state`, `context` and `uid` are
 * the bag's own. A key no `.context` declares is taken for a prop and never reported. When the
 * component also takes a prop of that name (its view destructures it, or a usage passes it), the
 * message says the prop wins.
 *
 * --fix, the pattern form: moves the keys into a `context: { … }` entry at the first one's place
 * (`(s, { id, route })` → `(s, { id, context: { route } })`), or into the pattern's existing
 * `context: { … }`. A TS annotation moves with them: a type literal's members the same way, any
 * other type wrapped (`{ route }: Ctx` → `{ context: { route } }: { context: Ctx }`) when the
 * pattern has no other keys. No fix with a rest element, a `context` entry that is not an object
 * pattern, or an annotation it can't rewrite (the message says why).
 * --fix, a plain parameter whose every use is a context field read (directly or in a helper):
 * takes the bag's context instead, `(s, context: Ctx)` → `(s, { context }: { context: Ctx })`,
 * `(s, b)` → `(s, { context: b })`, so the body reads the same names. No fix with a default.
 */
import { walk, unwrap, isFunction, propName, memberName, stringValue } from '../ast.js'
import { staticFunctions, declaredContextKeys, BAG_KEYS } from '../model/context.js'
import { resolveExpr } from '../model/resolve.js'
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

/** A type literal member's text without its trailing `;` / `,`. */
const memberText = (src, m) => src.slice(m.start, m.end).replace(/[;,]\s*$/, '')
const memberKey = (m) => m.type === 'TSPropertySignature' && !m.computed
  ? (m.key.type === 'Identifier' ? m.key.name : stringValue(m.key)) : null

/**
 * The rewritten type annotation of a bag pattern whose keys `moved` go into `context: { … }`
 * (`ctx`: the pattern's existing `context` entry): `{ type }` (null: keep it as it is), or
 * `{ reason }` (no fix). A type literal's members move the same way; another type is wrapped,
 * `{ context: Ctx }`, when the pattern has no other keys.
 */
function annotationFix(src, pat, moved, ctx, hasDefault) {
  const t = pat.typeAnnotation?.typeAnnotation
  if (!t) return { type: null }
  const text = (n) => src.slice(n.start, n.end)
  if (hasDefault) return { reason: 'the typed parameter has a default value, which the rewritten type would not fit' }
  if (t.type === 'TSTypeLiteral') {
    const keys = new Set(moved.map(propName))
    const movedMembers = t.members.filter(m => keys.has(memberKey(m)))
    if (!movedMembers.length) return { type: null }
    const cm = t.members.find(m => memberKey(m) === 'context')
    const cmType = cm?.typeAnnotation?.typeAnnotation
    if (cm && cmType?.type !== 'TSTypeLiteral') {
      return { reason: `the type annotation's 'context' (${cmType ? text(cmType) : 'untyped'}) is not a type literal the moved keys' types could go into` }
    }
    const sep = t.members.some(m => src[m.end - 1] === ';') ? '; ' : ', '
    const movedText = movedMembers.map(m => memberText(src, m))
    const parts = []
    for (const m of t.members) {
      if (movedMembers.includes(m)) {
        if (!cm && m === movedMembers[0]) parts.push(`context: { ${movedText.join(sep)} }`)
        continue
      }
      if (m === cm) {
        const all = [...cmType.members.map(x => memberText(src, x)), ...movedText].join(sep)
        parts.push(src.slice(cm.start, cmType.start) + `{ ${all} }`)
        continue
      }
      parts.push(memberText(src, m))
    }
    return { type: `{ ${parts.join(sep)} }` }
  }
  if (ctx || pat.properties.length > moved.length) return { reason: `its type annotation (${text(t)}) types the bag's other keys too` }
  return { type: `{ context: ${text(t)} }` }
}

/** The --fix edit for an object pattern, null, or `{ reason }` (the annotation stops it). */
function patternFix(file, pat, moved, hasDefault) {
  const src = file.source
  if (pat.properties.some(p => p.type === 'RestElement')) return null
  const text = (n) => src.slice(n.start, n.end)
  const ctx = pat.properties.find(p => p.type === 'ObjectProperty' && propName(p) === 'context')
  let inner = null // the existing context: { … } pattern
  if (ctx) {
    inner = ctx.value.type === 'AssignmentPattern' ? ctx.value.left : ctx.value
    if (inner.type !== 'ObjectPattern' || inner.properties.some(p => p.type === 'RestElement')) return null
  }
  const ann = annotationFix(src, pat, moved, ctx, hasDefault)
  if (ann.reason) return ann
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
  const end = patternEnd(src, pat)
  if (ann.type == null) return { file: file.path, start: pat.start, end, text: `{ ${parts.join(', ')} }` }
  const t = pat.typeAnnotation.typeAnnotation
  return { file: file.path, start: pat.start, end: t.end, text: `{ ${parts.join(', ')} }` + src.slice(end, t.start) + ann.type }
}

const TS_WRAPPERS = new Set(['TSAsExpression', 'TSNonNullExpression', 'TSTypeAssertion', 'TSSatisfiesExpression', 'ParenthesizedExpression', 'TypeCastExpression'])
const MAX_HELPER_DEPTH = 4

/**
 * How `body` uses the bag bound to `name`: `reads` (context fields read off it: `b.route`,
 * `const { route } = b`), `calls` (the bag passed to a same-module helper that reads context
 * fields off its parameter: `{ node, callee, keys }`), and `other`: any other use (a prop or
 * `state` read, the bag passed on whole, a helper the checker can't see), which rules out
 * rewriting the parameter to `{ context: b }`.
 */
function bagUses(project, file, body, name, ctxKeys, seen = new Set(), depth = 0) {
  const reads = []
  const calls = []
  let other = false
  const parents = new Map()
  walk(body, (n, parent) => { if (parent) parents.set(n, parent) })
  const keyOf = (k) => k && !BAG_KEYS.has(k) && ctxKeys.has(k) ? k : null
  // the context keys of a pattern off the bag; a prop / state key or a rest element is another use
  const fromPattern = (pat, at) => {
    for (const p of pat.properties) {
      const k = p.type === 'ObjectProperty' ? keyOf(propName(p)) : null
      if (k) at.push({ key: k, node: p.key })
      else other = true
    }
  }
  walk(body, (n, parent) => {
    if (n.type !== 'Identifier' || n.name !== name || !parent) return
    if ((parent.type === 'MemberExpression' || parent.type === 'OptionalMemberExpression') && parent.property === n && !parent.computed) return
    if ((parent.type === 'ObjectProperty' || parent.type === 'ObjectMethod') && parent.key === n && !parent.computed) return
    // through `b as Bag`, `b!`, `(b)`
    let child = n
    let p = parent
    while (p && TS_WRAPPERS.has(p.type)) { child = p; p = parents.get(p) }
    if ((p?.type === 'MemberExpression' || p?.type === 'OptionalMemberExpression') && p.object === child) {
      const k = keyOf(memberName(p) ?? (p.computed ? stringValue(p.property) : null))
      if (k) reads.push({ key: k, node: p.property })
      else other = true
    } else if (p?.type === 'VariableDeclarator' && p.init === child && p.id.type === 'ObjectPattern') {
      fromPattern(p.id, reads)
    } else if ((p?.type === 'CallExpression' || p?.type === 'OptionalCallExpression') && p.arguments.includes(child)) {
      // a same-module helper: what it reads off the parameter the bag lands in
      const h = depth < MAX_HELPER_DEPTH ? resolveExpr(project, file, p.callee) : null
      const helper = h?.file === file && isFunction(h.node) && !seen.has(h.node) ? h.node : null
      let q = helper?.params[p.arguments.indexOf(child)]
      if (q?.type === 'AssignmentPattern') q = q.left
      const keys = []
      if (q?.type === 'ObjectPattern') {
        const at = []
        fromPattern(q, at)
        keys.push(...at.map(x => x.key))
      } else if (q?.type === 'Identifier') {
        seen.add(helper)
        const u = bagUses(project, file, helper.body, q.name, ctxKeys, seen, depth + 1)
        seen.delete(helper)
        if (u.other) other = true
        keys.push(...u.reads.map(x => x.key), ...u.calls.flatMap(c => c.keys))
      } else {
        other = true
      }
      const callee = unwrap(p.callee)
      if (keys.length) calls.push({ node: child, callee: callee.type === 'Identifier' ? callee.name : 'a helper', keys: [...new Set(keys)] })
    } else {
      other = true
    }
  })
  return { reads, calls, other }
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
      const offBag = `off its second argument, the bag (7.2: { ...props, state, context, uid }); the context's fields are on the bag only until 8.0`
      for (const { path, file, node: fn } of fns) {
        let param = fn.params?.[1]
        const hasDefault = param?.type === 'AssignmentPattern'
        if (hasDefault) param = param.left
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
          const edit = patternFix(file, param, moved, hasDefault)
          const shown = keys.join(', ')
          report({
            code: 'SYG458',
            component: comp.name,
            file,
            node: moved[0].key,
            endNode: moved[moved.length - 1],
            message: `${where} reads the context field${keys.length > 1 ? 's' : ''} ${keys.map(k => `'${k}'`).join(', ')} ${offBag}` + propNote(keys) +
              (edit?.reason ? `; --fix leaves it: ${edit.reason}` : ''),
            fix: `read ${keys.length > 1 ? 'them' : 'it'} from the bag's context: (state, { context: { ${shown} } }) => …`,
            data: { static: path, keys },
            fixes: edit && !edit.reason ? [{ title: `Read ${shown} from the bag's context`, kind: 'quickfix', preferred: true, fixAll: true, edits: [edit] }] : undefined,
          })
          continue
        }
        if (param.type !== 'Identifier') continue
        const name = param.name
        const uses = bagUses(project, file, fn.body, name, ctxKeys)
        if (!uses.reads.length && !uses.calls.length) continue
        // every use reads the context: take the bag's context under the same name
        let fixes
        const taken = name === 'context' ? '{ context }' : `{ context: ${name} }`
        if (!uses.other && !hasDefault && !param.optional) {
          const t = param.typeAnnotation?.typeAnnotation
          const src = file.source
          const edit = t
            ? { file: file.path, start: param.start, end: t.end, text: taken + src.slice(param.start + name.length, t.start) + `{ context: ${src.slice(t.start, t.end)} }` }
            : { file: file.path, start: param.start, end: param.start + name.length, text: taken }
          fixes = [{ title: `Take the bag's context as ${name}`, kind: 'quickfix', preferred: true, fixAll: true, edits: [edit] }]
        }
        const suggest = (key) => fixes
          ? `take the bag's context: (state, ${taken}) => …`
          : `read it from the bag's context: ${name}.context.${key}`
        for (const { key, node } of uses.reads) {
          report({
            code: 'SYG458',
            component: comp.name,
            file,
            node,
            message: `${where} reads the context field '${key}' ${offBag}` + propNote([key]),
            fix: suggest(key),
            data: { static: path, keys: [key] },
            fixes,
          })
        }
        for (const { node, callee, keys } of uses.calls) {
          report({
            code: 'SYG458',
            component: comp.name,
            file,
            node,
            message: `${where} passes its second argument, the bag, to ${callee}(), which reads the context field${keys.length > 1 ? 's' : ''} ${keys.map(k => `'${k}'`).join(', ')} off it (7.2: the bag is { ...props, state, context, uid }); the context's fields are on the bag only until 8.0` + propNote(keys),
            fix: fixes ? `pass the bag's context: (state, ${taken}) => …` : `pass the bag's context: ${callee}(${name}.context)`,
            data: { static: path, keys, helper: callee },
            fixes,
          })
        }
      }
    }
  },
}
