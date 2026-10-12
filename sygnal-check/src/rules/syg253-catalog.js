/**
 * PLAN-9 X-2: `defineCatalog({...})` (sygnal/ai), statically, where the declaration is a literal
 * (model/catalog.js). The runtime codes (X-1, src/extra/ai/compose/catalog.ts) where the checker can
 * see the same thing, plus two static-only ones:
 *
 * SYG162  a part with neither `component` nor `render` (no spread in it): it renders nothing.
 * SYG161  a container `render` that is a component with a model (`.model`, `.intent`,
 *         `.initialState` or `.uses`, also through an import, or `defineComponent({ model, ... })`):
 *         it is called as a view, its model never runs.
 * SYG450  `in` naming an unknown container or slot, or the built-in `row`; a container `min` / `max`
 *         that is not a non-negative integer, `min` above `max`, `accepts` other than 'leaves'.
 * SYG250  a `companions` entry that is not a part of the catalog (or the part itself).
 * SYG680  (info) a part with a `required` text or list param without a `default`, in a catalog
 *         passed to `compose(catalog, { backend: compose.decisions(...) })` in a scanned file (the
 *         backend a `compose.decisions()` call, directly or through a `const`): the decision
 *         backend never places it. Catalogs whose backend the checker can't see are not judged.
 * SYG253  a key of the declaration, a part, a container or a param that is a misspelling of a known
 *         one ('descrption', 'compnent', 'deafult'): "did you mean", with a rename quick fix. Other
 *         unknown keys are left alone (an app may keep its own data on a part: `part.decl`).
 * SYG254  (info) the description lint (model/catalogLint.js): two parts whose descriptions share a
 *         phrase, a part description naming one of its own param values, two params of a part whose
 *         options share a word.
 *
 * Ids the checker can't list (a spread, a computed key, a non-literal `parts` / `containers`) turn
 * the "unknown" checks off for that catalog.
 */
import { unwrap, propName, isFunction, walk, memberName } from '../ast.js'
import { findBinding } from '../scope.js'
import { resolveExpr } from '../model/resolve.js'
import { findCatalogs, literalObject, literalString, literalValue, objOf } from '../model/catalog.js'
import { lintCatalog } from '../model/catalogLint.js'
import { renameFix, keyEdit } from '../edits.js'

const KEYS = {
  catalog: ['parts', 'containers', 'description', 'categories', 'rows', 'guidance', 'limits', 'examples'],
  part: ['component', 'render', 'props', 'description', 'state', 'local', 'params', 'in', 'group', 'maxUses', 'required', 'pin', 'companions', 'category', 'result'],
  container: ['slots', 'minSlots', 'min', 'max', 'accepts', 'arranged', 'direction', 'description', 'in', 'params', 'render'],
  param: ['options', 'default', 'label', 'ask', 'type', 'min', 'max', 'bins', 'maxLength', 'required', 'items', 'from'],
}

/** optimal string alignment distance (a transposition counts 1: 'deafult' → 'default') */
function distance(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i])
  for (let j = 1; j <= b.length; j++) d[0][j] = j
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1)
    }
  }
  return d[a.length][b.length]
}

/** the known key `name` misspells, or null */
export function misspelled(name, known) {
  if (known.includes(name)) return null
  let best = null, bestD = Infinity
  for (const k of known) {
    const dd = name.toLowerCase() === k.toLowerCase() ? 0.5 : distance(name.toLowerCase(), k.toLowerCase())
    if (dd < bestD) { best = k; bestD = dd }
  }
  return best && bestD <= Math.max(1, Math.floor(Math.max(name.length, best.length) / 4)) ? best : null
}

const isSygnalImport = (b, name) => b?.kind === 'import' && b.imported === name && /^sygnal(\/ai)?$/.test(b.source)

/** is `node` (resolved) a component with a model: statics on a function, or defineComponent({ model, ... }) */
function componentWithModel(project, file, node) {
  const r = resolveExpr(project, file, node)
  if (!r?.node) return null
  const n = unwrap(r.node)
  if (isFunction(n) || n.type === 'FunctionDeclaration' || n.type === 'ClassDeclaration') {
    const comp = project.componentForFunction(n) || r.file?.components?.find(c => c.node === n || c.view === n)
    if (!comp) return null
    const has = ['model', 'intent', 'initialState', 'uses'].filter(k => comp.staticProps?.[k])
    return has.length ? { name: comp.name, has } : null
  }
  if (n.type === 'CallExpression') {
    const c = unwrap(n.callee)
    if (c?.type !== 'Identifier' || !isSygnalImport(findBinding(r.file, c.name, c), 'defineComponent')) return null
    const o = literalObject(r.file, n.arguments[0])
    if (!o) return null
    const keys = o.properties.map(p => p.type === 'SpreadElement' ? null : propName(p))
    const has = ['model', 'intent', 'initialState', 'uses'].filter(k => keys.includes(k))
    return has.length ? { name: unwrap(node).name || 'defineComponent(...)', has } : null
  }
  return null
}

/** the strings of an `in` value: [{ value, node }] (non-literal entries left out) */
function places(node) {
  const n = unwrap(node)
  if (!n) return []
  const one = (x) => { const v = literalString(x); return v === undefined ? [] : [{ value: v, node: unwrap(x) }] }
  return n.type === 'ArrayExpression' ? n.elements.flatMap(e => e ? one(e) : []) : one(n)
}

/** container id → its slot names (null: unknown) */
function slotsOf(entry) {
  if (!entry?.obj) return null
  if (entry.obj.open && !entry.obj.props.has('slots')) return null
  const sp = entry.obj.props.get('slots')
  if (!sp) return ['default']
  const o = sp.type === 'ObjectProperty' ? unwrap(sp.value) : null
  if (o?.type !== 'ObjectExpression') return null
  const so = objOf(o)
  if (so.open) return null
  return so.props.size ? [...so.props.keys()] : ['default']
}

/** the catalogs passed to compose(catalog, { backend: compose.decisions(...) }) in scanned files: Set<defineCatalog call node> */
function decisionCatalogs(project) {
  const out = new Set()
  const isDecisions = (file, node, depth = 0) => {
    let n = unwrap(node)
    if (n?.type === 'Identifier' && depth < 4) {
      const b = findBinding(file, n.name, n)
      return b?.kind === 'var' && b.declKind === 'const' && !!b.init && isDecisions(file, b.init, depth + 1)
    }
    if (n?.type !== 'CallExpression') return false
    const c = unwrap(n.callee)
    if (c?.type !== 'MemberExpression' || memberName(c) !== 'decisions') return false
    const o = unwrap(c.object)
    return o?.type === 'Identifier' && isSygnalImport(findBinding(file, o.name, o), 'compose')
  }
  for (const p of project.scanned) {
    const file = project.files.get(p)
    if (!file || !file.source.includes('compose')) continue
    walk(file.ast.program, (n) => {
      if (n.type !== 'CallExpression') return true
      const c = unwrap(n.callee)
      if (c?.type !== 'Identifier' || !isSygnalImport(findBinding(file, c.name, c), 'compose')) return true
      const opts = literalObject(file, n.arguments[1])
      const backend = opts && objOf(opts).props.get('backend')
      if (!backend || backend.type !== 'ObjectProperty' || !isDecisions(file, backend.value)) return true
      const r = resolveExpr(project, file, n.arguments[0])
      const cat = unwrap(r?.node)
      if (cat?.type === 'CallExpression') out.add(cat)
      return true
    })
  }
  return out
}

/** plain data for the description lint, with the nodes to report at */
function lintInput(cat) {
  const parts = {}
  const nodes = {}
  for (const [id, e] of cat.parts || []) {
    if (!e?.obj) continue
    const dp = e.obj.props.get('description')
    const description = dp?.type === 'ObjectProperty' ? literalString(dp.value) : undefined
    if (description === undefined) continue
    const gp = e.obj.props.get('group')
    const params = {}
    const optNodes = {}
    for (const [name, prm] of e.params || []) {
      if (!prm.obj) continue
      const ok = prm.obj.props.has('options') ? 'options' : prm.obj.props.has('bins') ? 'bins' : null
      const op = ok && prm.obj.props.get(ok)
      const oo = op?.type === 'ObjectProperty' ? literalObject(cat.file, op.value) : null
      if (!oo) continue
      const options = {}
      optNodes[name] = {}
      for (const [v, pp] of objOf(oo).props) {
        const d = pp.type === 'ObjectProperty' ? literalString(pp.value) : undefined
        if (d === undefined) continue
        options[v] = d
        optNodes[name][v] = pp
      }
      const dv = prm.obj.props.get('default')
      params[name] = { [ok]: options, ...(dv?.type === 'ObjectProperty' && literalValue(dv.value) !== undefined ? { default: literalValue(dv.value) } : {}) }
    }
    parts[id] = { description, group: gp?.type === 'ObjectProperty' ? literalString(gp.value) : undefined, params }
    nodes[id] = { description: unwrap(dp.value), options: optNodes }
  }
  return { parts, nodes }
}

export default {
  id: 'catalog',
  codes: ['SYG161', 'SYG162', 'SYG250', 'SYG253', 'SYG254', 'SYG450', 'SYG680'],
  description: 'defineCatalog declarations (sygnal/ai): parts without a view, component container renders, unknown places, misspelled keys, overlapping descriptions',
  run(project, report) {
    const catalogs = findCatalogs(project)
    if (!catalogs.length) return
    const decided = decisionCatalogs(project)

    for (const cat of catalogs) {
      const { file } = cat
      const misspell = (obj, kind, where) => {
        if (!obj) return
        for (const [k, prop] of obj.props) {
          const want = misspelled(k, KEYS[kind])
          if (!want) continue
          report({
            code: 'SYG253', file, node: prop.key,
            message: `${where}: \`${k}\` is not a ${kind == 'catalog' ? 'catalog declaration' : kind} key; did you mean \`${want}\`? defineCatalog ignores it`,
            fix: `rename it to \`${want}\``,
            data: { key: k, expected: want, kind },
            fixes: renameFix(`Rename '${k}' to '${want}'`, keyEdit(file, prop.key, want)),
          })
        }
      }
      misspell(cat.obj, 'catalog', 'defineCatalog')

      // known containers and their slots (null: unknown)
      const rowsOff = literalValue(cat.obj.props.get('rows')?.value) === false || cat.containers?.get('row') === false
      const containers = new Map([['page', ['default']]])
      for (const [id, e] of cat.containers || []) if (e !== false && id !== 'row' && id !== 'page') containers.set(id, slotsOf(e))
      const checkIn = (entry, label) => {
        const ip = entry.obj?.props.get('in')
        if (!ip || ip.type !== 'ObjectProperty') return
        for (const { value, node } of places(ip.value)) {
          const [c, s] = value.split(':')
          let problem = null
          if (c === 'row') problem = rowsOff ? "the built-in 'row', which this catalog turns off" : "'row' (a row is placed where its parts may go)"
          else if (!containers.has(c)) { if (!cat.containersOpen) problem = `an unknown container '${c}'` }
          else if (s !== undefined && containers.get(c) && !containers.get(c).includes(s)) problem = `an unknown slot '${s}' of '${c}' (its slots: ${containers.get(c).join(', ')})`
          if (!problem) continue
          const names = [...containers.keys()].filter(k => k !== 'page')
          report({
            code: 'SYG450', file, node,
            message: `${label}: \`in\` names ${problem}; defineCatalog ignores that entry`,
            fix: c === 'row' ? "name the containers it may go in; it is put in a row when the request asks for side by side" : `name 'page', a container of the catalog${names.length ? ` (${names.join(', ')})` : ''} or 'container:slot'`,
            data: { in: value },
          })
        }
      }

      // containers
      for (const [id, e] of cat.containers || []) {
        if (e === false || !e.obj) continue
        misspell(e.obj, 'container', `container '${id}'`)
        for (const [name, prm] of e.params || []) misspell(prm.obj, 'param', `container '${id}', param '${name}'`)
        if (id !== 'page' && id !== 'row') checkIn(e, `container '${id}'`)
        const rp = e.obj.props.get('render')
        if (rp?.type === 'ObjectProperty') {
          const comp = componentWithModel(project, file, rp.value)
          if (comp) {
            report({
              code: 'SYG161', file, node: rp.value, anchor: rp,
              message: `container '${id}': its render is ${comp.name}, a component with ${comp.has.map(h => '.' + h).join(', ')}; a container's render is called as a view function, so its ${comp.has.join(' and ')} never run (and a component would own the parts, so the host's CHILD.select and lenses stop reaching them)`,
              fix: `make render a view function: ({ slots, children, ui, control }) => <div>{slots.default}</div>; keep the container's UI state in \`ui\` (control(name, value))`,
              data: { container: id, component: comp.name },
            })
          }
        }
        const num = (k) => {
          const p = e.obj.props.get(k)
          if (p?.type !== 'ObjectProperty') return undefined
          const v = literalValue(p.value)
          if (v === undefined || v === null) return undefined
          if (Number.isInteger(v) && v >= 0) return v
          report({ code: 'SYG450', file, node: p.value, message: `container '${id}': \`${k}\` must be a non-negative integer (children per slot); defineCatalog ignores it`, fix: `use a whole number, e.g. ${k}: ${k === 'min' ? 1 : 4}`, data: { key: k } })
          return undefined
        }
        const min = num('min'), max = num('max')
        if (min !== undefined && max !== undefined && min > max) {
          report({ code: 'SYG450', file, node: e.obj.props.get('min').value, message: `container '${id}': \`min\` ${min} is above \`max\` ${max}; defineCatalog ignores both`, fix: 'make min at most max', data: { min, max } })
        }
        const ap = e.obj.props.get('accepts')
        const av = ap?.type === 'ObjectProperty' ? literalValue(ap.value) : undefined
        if (av !== undefined && av !== null && av !== 'leaves') {
          report({ code: 'SYG450', file, node: ap.value, message: `container '${id}': \`accepts\` takes only 'leaves'; defineCatalog ignores it`, fix: "accepts: 'leaves' (only parts in its slots), or leave it out", data: { accepts: av } })
        }
      }

      // parts
      const partIds = cat.parts ? [...cat.parts.keys()] : []
      for (const [id, e] of cat.parts || []) {
        if (!e?.obj) continue
        misspell(e.obj, 'part', `part '${id}'`)
        for (const [name, prm] of e.params || []) misspell(prm.obj, 'param', `part '${id}', param '${name}'`)
        checkIn(e, `part '${id}'`)
        if (!e.obj.open && !e.obj.props.has('component') && !e.obj.props.has('render')) {
          const near = [...e.obj.props.keys()].find(k => misspelled(k, ['component', 'render']))
          report({
            code: 'SYG162', file, node: e.keyNode, anchor: e.prop,
            message: `part '${id}' has neither a component nor a render function: it renders nothing` + (near ? ` (\`${near}\` is not \`${misspelled(near, ['component', 'render'])}\`)` : ''),
            fix: `give it a component (component: ${id[0].toUpperCase() + id.slice(1)}) or a view function (render: (props) => <div>…</div>)`,
            data: { part: id },
          })
        }
        const cp = e.obj.props.get('companions')
        const ca = cp?.type === 'ObjectProperty' ? unwrap(cp.value) : null
        if (ca?.type === 'ArrayExpression' && !cat.partsOpen) {
          for (const el of ca.elements) {
            const v = el && literalString(el)
            if (v === undefined || (cat.parts.has(v) && v !== id)) continue
            report({
              code: 'SYG250', file, node: el,
              message: `part '${id}': the companion '${v}' is ${v === id ? 'the part itself' : 'not a part of this catalog'}; defineCatalog ignores it`,
              fix: `name another part of the catalog (${partIds.filter(p => p !== id).slice(0, 6).join(', ')}${partIds.length > 7 ? ', …' : ''})`,
              data: { part: id, companion: v },
            })
          }
        }
        // SYG680: a required text / list param without a default, under compose.decisions()
        if (decided.has(cat.call)) {
          for (const [name, prm] of e.params || []) {
            if (!prm.obj) continue
            const t = literalValue(prm.obj.props.get('type')?.value)
            const req = literalValue(prm.obj.props.get('required')?.value)
            if ((t !== 'text' && t !== 'list') || req !== true || prm.obj.props.has('default') || prm.obj.open) continue
            report({
              code: 'SYG680', file, node: prm.keyNode,
              message: `part '${id}': its ${t} param '${name}' is required and has no default, so a decision model (compose.decisions()) can't fill it and never places '${id}': the part is LLM-only`,
              fix: `give '${name}' a default (the decision backend keeps it), drop required, or compose with compose.llm()`,
              data: { part: id, param: name },
            })
          }
        }
      }

      // SYG254: the description lint
      const { parts, nodes } = lintInput(cat)
      for (const f of lintCatalog({ parts })) {
        if (f.kind === 'parts') {
          const [first, ...rest] = f.parts
          report({
            code: 'SYG254', file, node: nodes[first].description,
            message: `the descriptions of ${f.parts.map(p => `'${p}'`).join(', ')} share the phrase "${f.phrase}": a model reading "${f.phrase}" in a request can't tell them apart, and picks the wrong part or both`,
            fix: `lead each description with the noun a user says for it ("Revenue (KPI card: ...)", "Revenue chart (line chart ...)") and keep the shared words in one of them; parts that are alternatives go in one \`group\``,
            related: rest.map((p, i) => ({ node: nodes[p].description, message: `'${p}' says "${f.phrases[i + 1]}"` })),
            data: { kind: 'parts', parts: f.parts, phrase: f.phrase },
          })
        } else if (f.kind === 'mentions') {
          const on = nodes[f.part].options[f.param]?.[f.option]
          report({
            code: 'SYG254', file, node: nodes[f.part].description,
            message: `part '${f.part}': its description says "${f.word}", which names the '${f.option}' option of its param '${f.param}'; the description is read for every value, so a request for another '${f.param}' is answered with this one, or the part is shown back with two values`,
            fix: `leave the ${f.param} out of the description: the param supplies it`,
            related: on ? [{ node: on, message: `the '${f.option}' option of '${f.param}'` }] : undefined,
            data: { kind: 'mentions', part: f.part, param: f.param, option: f.option, word: f.word },
          })
        } else {
          const a = nodes[f.part].options[f.param]?.[f.option]
          const b = nodes[f.part].options[f.other]?.[f.otherOption]
          report({
            code: 'SYG254', file, node: a?.value || nodes[f.part].description,
            message: `part '${f.part}': the '${f.option}' option of '${f.param}' and the '${f.otherOption}' option of '${f.other}' share the word "${f.word}": a request using it can set the wrong param ("all tickets, not just the urgent ones" picked status=all, not priority=any)`,
            fix: `word the options of different params apart: each option names only what its own param changes`,
            related: b ? [{ node: b.value, message: `the '${f.otherOption}' option of '${f.other}'` }] : undefined,
            data: { kind: 'options', part: f.part, params: [f.param, f.other], options: [f.option, f.otherOption], word: f.word },
          })
        }
      }
    }
  },
}
