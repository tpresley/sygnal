/**
 * PLAN-6 K-1: the `agent` static (sygnal/ai, A-1), statically.
 *
 * SYG150  an `agent.actions` key with no model entry (and no behavior action of that name): the
 *         tool is offered, and every call dispatches an action nothing handles ("changed nothing").
 * SYG151  a misspelled static: `agents`, `tools`, `Agent`, ... on a component → "did you mean
 *         `agent`?" (D242). The agent layer reads only `agent`, so nothing is offered.
 * SYG440  two declarations with the same tool-name prefix (`agent.name`, else the component name,
 *         snake_case as the runtime does) in one app: one component renders both (directly or
 *         through its children). The runtime reports it when both are shown.
 * SYG441  a Collection item component with an `agent` whose items have no `id`: the parent's
 *         initialState array holds object literals without `id`, or its model appends one to the
 *         array (`[...state.todos, { text }]`). The runtime keys such items by index (G-618).
 *         The same id in two Collections (G-591) needs the data: runtime only.
 * SYG240  (G-611) an `input` the agent layer can't turn into a JSON Schema: a Valibot schema not
 *         wrapped with `toStandardJsonSchema()`, a Zod Mini schema, or a raw JSON Schema object
 *         (needs `jsonSchema()`). The runtime leaves the tool out.
 * SYG243  (G-611) a `Date` in an `input` (`z.date()`, `v.date()`, ArkType 'Date'): JSON can't carry
 *         a Date, so the model sees no schema for it and its string fails validation.
 *
 * Only literal declarations are judged; spreads, computed keys and values the checker can't
 * follow are skipped.
 */
import { walk, unwrap, propName, memberName, isFunction } from '../ast.js'
import { findBinding } from '../scope.js'
import { resolveExpr } from '../model/resolve.js'
import { behaviorActions, openPrefixes } from '../model/behaviors.js'
import { agentName } from '../model/agent.js'
import { BUILTIN_ACTIONS } from '../model/modelEntries.js'

const MISSPELLED = new Set(['agents', 'Agent', 'Agents', 'AGENT', 'tools', 'tool', 'Tools', 'agnet', 'aget', 'agen'])

function distance(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i])
  for (let j = 1; j <= b.length; j++) d[0][j] = j
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    }
  }
  return d[a.length][b.length]
}

function closest(name, candidates) {
  let best = null
  let bestD = Infinity
  for (const c of candidates) {
    const dd = distance(name.toUpperCase(), c.toUpperCase())
    if (dd < bestD) { best = c; bestD = dd }
  }
  return best && bestD <= Math.max(1, Math.floor(name.length / 4)) ? best : null
}

// ---------------------------------------------------------------------------
// Schema libraries (G-611)

const LIBS = [
  [/^valibot$/, 'valibot'],
  [/^zod(\/v4)?\/mini$|^zod\/v4-mini$|^@zod\/mini$/, 'zod-mini'],
  [/^zod(\/v[34])?$/, 'zod'],
  [/^arktype$/, 'arktype'],
]
const libOfSource = (src) => (LIBS.find(([re]) => re.test(src)) || [])[1] || null

function importOf(file, ident) {
  ident = unwrap(ident)
  if (ident?.type !== 'Identifier') return null
  const b = findBinding(file, ident.name, ident)
  return b?.kind === 'import' ? b : null
}

const JSON_SCHEMA_KEYS = new Set(['type', 'properties', 'anyOf', 'oneOf', 'allOf', 'enum', '$schema', 'items', 'const'])

/**
 * What an `input` expression is: 'valibot' | 'zod' | 'zod-mini' | 'arktype' (the library its
 * chain starts from), 'wrapped' (toStandardJsonSchema() / jsonSchema()), 'json' (a raw JSON
 * Schema object literal), or null (unknown: say nothing).
 */
function inputKind(project, file, node, depth = 0) {
  if (depth > 8) return null
  let n = unwrap(node)
  if (!n) return null
  if (n.type === 'Identifier') {
    const imp = importOf(file, n)
    if (imp && !/^[./]/.test(imp.source)) return libOfSource(imp.source)
    const r = resolveExpr(project, file, n)
    if (!r?.node || r.node === n) return null
    return inputKind(project, r.file, r.node, depth + 1)
  }
  if (n.type === 'CallExpression') {
    const imp = importOf(file, n.callee)
    if (imp && ((imp.imported === 'toStandardJsonSchema' && /^@valibot\/to-json-schema$/.test(imp.source)) ||
        (imp.imported === 'jsonSchema' && /^sygnal(\/|$)/.test(imp.source)))) return 'wrapped'
    return inputKind(project, file, n.callee, depth + 1)
  }
  if (n.type === 'MemberExpression' || n.type === 'OptionalMemberExpression') return inputKind(project, file, n.object, depth + 1)
  if (n.type === 'ObjectExpression') {
    const keys = n.properties.filter(p => p.type === 'ObjectProperty').map(propName)
    return keys.some(k => JSON_SCHEMA_KEYS.has(k)) ? 'json' : null
  }
  return null
}

/** The first Date schema inside an input expression (following local consts): { node, file, text } | null */
function findDate(project, file, node) {
  const seen = new Set()
  let hit = null
  const visit = (f, root, depth) => {
    if (!root || hit || depth > 6 || seen.has(root)) return
    seen.add(root)
    walk(root, (n) => {
      if (hit) return false
      if (n.type === 'CallExpression') {
        const c = unwrap(n.callee)
        // z.date(), z.coerce.date(), v.date()
        if ((c.type === 'MemberExpression') && memberName(c) === 'date') {
          const lib = inputKind(project, f, c.object)
          if (lib === 'zod' || lib === 'zod-mini' || lib === 'valibot') { hit = { node: n, file: f, text: f.source.slice(n.start, n.end) }; return false }
        }
        // date() imported from valibot / zod
        const imp = importOf(f, c)
        if (imp && imp.imported === 'date' && ['valibot', 'zod', 'zod-mini'].includes(libOfSource(imp.source))) { hit = { node: n, file: f, text: f.source.slice(n.start, n.end) }; return false }
        // ArkType: type({ when: 'Date' }), type('Date | null')
        if (imp && imp.imported === 'type' && libOfSource(imp.source) === 'arktype') {
          walk(n, (m) => {
            if (hit) return false
            const s = m.type === 'StringLiteral' ? m.value : null
            if (s != null && /(^|[^\w.])Date([^\w]|$)/.test(s)) hit = { node: m, file: f, text: `'${s}'` }
            return true
          })
          if (hit) return false
        }
      }
      if (n.type === 'Identifier' && n !== root) {
        const p = f.parents.get(n)
        // a reference (not a key or a member name)
        if (p && ((p.type === 'MemberExpression' && p.property === n && !p.computed) || (p.type === 'ObjectProperty' && p.key === n && !p.shorthand))) return true
        const b = findBinding(f, n.name, n)
        if (b?.kind === 'var' && b.init) {
          const r = resolveExpr(project, f, n)
          if (r?.node && r.node !== n) visit(r.file, r.node, depth + 1)
        }
      }
      return true
    })
  }
  const r = resolveExpr(project, file, node)
  if (r?.node) visit(r.file, r.node, 0)
  return hit
}

// ---------------------------------------------------------------------------
// The component tree (SYG440)

function rendered(project, comp) {
  const out = []
  const visitSink = (sink, seen) => {
    if (!sink || seen.has(sink)) return
    seen.add(sink)
    for (const u of sink.children) {
      const c = u.ref && project.componentForFunction(u.ref.node)
      if (c) out.push(c)
      visitSink(u.injected, seen)
    }
  }
  visitSink(comp.viewInfo, new Set())
  return out
}

function reachMap(project) {
  const direct = new Map(project.components.map(c => [c, rendered(project, c)]))
  const reach = new Map()
  for (const c of project.components) {
    const set = new Set([c])
    const stack = [c]
    while (stack.length) {
      const x = stack.pop()
      for (const y of direct.get(x) || []) if (!set.has(y)) { set.add(y); stack.push(y) }
    }
    reach.set(c, set)
  }
  return reach
}

// ---------------------------------------------------------------------------
// Collection items without ids (SYG441)

const hasKey = (obj, key) => obj.properties.some(p => p.type !== 'SpreadElement' && propName(p) === key)
const idless = (obj) => obj?.type === 'ObjectExpression' && !obj.properties.some(p => p.type === 'SpreadElement') && !hasKey(obj, 'id')

/** An object literal without `id` in the initial array, or appended to state[from] by the model. */
function idlessItem(project, parent, from) {
  const init = parent.initialState?.keys.get(from)
  const arr = init && unwrap(init.node)
  if (arr?.type === 'ArrayExpression') {
    const el = arr.elements.map(unwrap).find(idless)
    if (el) return { node: el, file: init.file, where: `${parent.name}.initialState.${from}` }
  }
  if (!parent.staticProps.model) return null
  const r = resolveExpr(project, parent.file, parent.staticProps.model)
  if (!r?.node) return null
  let hit = null
  const seen = new Set()
  // the model object, and the module-level helpers it calls (`ADD: (s, t) => ({ ...s, ...addTodo(s, t) })`)
  const scan = (f, root) => {
    if (seen.has(root)) return
    seen.add(root)
    walk(root, (n) => {
      if (hit) return false
      if (n.type === 'Identifier' && n !== root) {
        const b = findBinding(f, n.name, n)
        const fn = b?.kind === 'function' ? b.node : b?.kind === 'var' && isFunction(unwrap(b.init)) ? unwrap(b.init) : null
        if (fn && !seen.has(fn) && !(fn.start <= n.start && n.end <= fn.end)) scan(f, fn)
        return true
      }
      if (n.type !== 'ArrayExpression') return true
      const spreadsFrom = n.elements.some(e => {
        const arg = e?.type === 'SpreadElement' && unwrap(e.argument)
        return arg && (arg.type === 'MemberExpression' ? memberName(arg) === from : arg.type === 'Identifier' && arg.name === from)
      })
      if (!spreadsFrom) return true
      const el = n.elements.map(unwrap).find(idless)
      if (el) hit = { node: el, file: f, where: `${parent.name}.model` }
      return true
    })
  }
  scan(r.file, r.node)
  return hit
}

export default {
  id: 'agent',
  codes: ['SYG150', 'SYG151', 'SYG440', 'SYG441', 'SYG240', 'SYG243'],
  description: 'agent static (sygnal/ai): actions without model entries, misspellings, name collisions, Collection items without ids, input schemas',
  run(project, report) {
    // SYG151: X.agents = { ... } on a component
    for (const p of project.scanned) {
      const file = project.files.get(p)
      if (!file) continue
      walk(file.ast.program, (n) => {
        if (n.type !== 'AssignmentExpression' || n.operator !== '=' || n.left.type !== 'MemberExpression') return true
        const prop = memberName(n.left)
        if (!MISSPELLED.has(prop)) return true
        const obj = unwrap(n.left.object)
        if (obj.type !== 'Identifier') return true
        const b = findBinding(file, obj.name, obj)
        if (!b || b.kind === 'import' || b.kind === 'param') return true
        const comp = file.components.find(c => c.node === b.node)
        const value = unwrap(n.right)
        const looksLikeAgent = value?.type === 'ObjectExpression' && (hasKey(value, 'actions') || hasKey(value, 'read'))
        if (!comp && !looksLikeAgent) return true
        report({
          code: 'SYG151',
          component: comp?.name ?? obj.name,
          file, node: n.left.property,
          message: `${obj.name}.${prop}: did you mean \`agent\`? The agent layer (sygnal/ai) reads only ${obj.name}.agent, so no tool is offered for ${obj.name}`,
          fix: `rename it: ${obj.name}.agent = { name, description, read, actions: { ACTION: { description } } }`,
          data: { static: prop, expected: 'agent' },
        })
        return true
      })
    }

    const withAgent = project.components.filter(c => c.agent)

    for (const comp of withAgent) {
      const a = comp.agent
      // SYG150: an agent action with no model entry
      const model = comp.model
      const usesOpen = comp.uses && (!comp.uses.known || comp.uses.entries.some(e => e.status === 'opaque'))
      if (a.actionsKnown && (!model || model.known) && !usesOpen) {
        const entries = new Set((model?.entries || []).map(e => e.action))
        const owned = behaviorActions(comp.uses)
        const open = openPrefixes(comp.uses)
        for (const act of a.actions) {
          if (entries.has(act.name) || owned.has(act.name) || BUILTIN_ACTIONS.has(act.name) || open.some(p => act.name.startsWith(p))) continue
          const near = closest(act.name, [...entries, ...owned.keys()])
          report({
            code: 'SYG150',
            component: comp.name,
            file: act.file, node: act.node,
            message: `${comp.name}.agent.actions.${act.name} has no model entry: an agent's call dispatches '${act.name}', nothing handles it, and the call fails with "changed nothing"` +
              (near ? ` (did you mean '${near}'?)` : ''),
            fix: near
              ? `rename the key to '${near}', or add ${comp.name}.model.${act.name}`
              : `add a model entry: ${comp.name}.model = { ${act.name}: (state, data) => ({ ...state }) }, or remove the action from agent.actions`,
            data: { action: act.name, ...(near && { suggestion: near }) },
          })
        }
      }

      // SYG240 / SYG243: the input schemas (G-611)
      for (const act of a.actions) {
        if (!act.input) continue
        const { node, file } = act.input
        const kind = inputKind(project, file, node)
        const where = `${comp.name}.agent.actions.${act.name}.input`
        if (kind === 'valibot' || kind === 'zod-mini' || kind === 'json') {
          const fix = kind === 'valibot'
            ? "wrap it: input: toStandardJsonSchema(v.…) (import { toStandardJsonSchema } from '@valibot/to-json-schema')"
            : kind === 'zod-mini'
              ? "keep Zod Mini's validation and give it a JSON Schema: input: jsonSchema(z.toJSONSchema(schema), { validate: schema }) (import { jsonSchema } from 'sygnal/ai'), or use the full zod package"
              : "wrap it: input: jsonSchema({ type: … }) (import { jsonSchema } from 'sygnal/ai'), or write it with a schema library (Zod 4.2+, ArkType 2.1.28+, Valibot with toStandardJsonSchema())"
          report({
            code: 'SYG240',
            component: comp.name,
            file, node,
            message: `${where} ${kind === 'valibot' ? 'is a Valibot schema without toStandardJsonSchema()' : kind === 'zod-mini' ? 'is a Zod Mini schema' : 'is a plain JSON Schema object'}: it has no Standard JSON Schema form, so the agent layer can't describe it to the model and leaves the '${act.name}' tool out`,
            fix,
            data: { action: act.name, kind },
          })
          continue
        }
        const date = findDate(project, file, node)
        if (date) {
          report({
            code: 'SYG243',
            component: comp.name,
            file: date.file, node: date.node,
            message: `${where} contains a Date (${date.text.length > 60 ? date.text.slice(0, 57) + '...' : date.text}): JSON can't carry a Date, so the model gets no schema for it and the string it sends fails validation`,
            fix: "take an ISO string and convert it in the reducer: z.iso.datetime() (Zod), v.pipe(v.string(), v.isoDateTime()) (Valibot), 'string.date.iso' (ArkType)",
            data: { action: act.name },
          })
        }
      }
    }

    // SYG440: two declarations with the same name in one app
    const named = withAgent.map(c => ({ c, name: agentName(c) })).filter(x => x.name)
    if (named.length > 1) {
      const reach = reachMap(project)
      const reported = new Set()
      for (let i = 0; i < named.length; i++) {
        for (let j = 0; j < i; j++) {
          const A = named[j]
          const B = named[i]
          if (A.name !== B.name || A.c === B.c || reported.has(B.c)) continue
          const together = project.components.some(r => reach.get(r).has(A.c) && reach.get(r).has(B.c))
          if (!together) continue
          reported.add(B.c)
          const at = B.c.agent.nameNode || B.c.staticPropNodes.agent
          report({
            code: 'SYG440',
            component: B.c.name,
            file: B.c.agent.nameNode ? B.c.agent.file : B.c.file, node: at,
            message: `${B.c.name}.agent and ${A.c.name}.agent are both named '${A.name}' (tools ${A.name}_…) in one app: only the first one shown is offered, the other's tools can't be reached`,
            fix: `give each declaration its own name: ${B.c.name}.agent = { name: '${A.name}_2', ... }`,
            data: { name: A.name, other: A.c.name },
          })
        }
      }
    }

    // SYG441: Collection items with an agent but no ids
    const done = new Set()
    for (const parent of project.components) {
      for (const col of parent.viewInfo?.collections || []) {
        if (col.kind !== 'collection' || col.from == null) continue
        for (const t of col.targets) {
          const item = t.ref && project.componentForFunction(t.ref.node)
          if (!item?.agent?.known || done.has(item)) continue
          const hit = idlessItem(project, parent, col.from)
          if (!hit) continue
          done.add(item)
          report({
            code: 'SYG441',
            component: item.name,
            file: hit.file, node: hit.node,
            message: `${item.name} has an agent declaration and is a Collection item of ${parent.name} (from="${col.from}"), but this item in ${hit.where} has no id: agents address items by id, so they'd be keyed by their index, which shifts when an item is added or removed`,
            fix: `give every item an id that is unique across the Collections of ${item.name}: { id: state.nextId, ... }`,
            data: { item: item.name, parent: parent.name, from: col.from },
          })
        }
      }
    }
  },
}
