/**
 * Side effects outside a declared output (SYG265, SYG266, SYG511, SYG512; research:
 * dev-plans/research/undeclared-effects).
 *
 *   effectRoots(project, comp)              → Array<Root>   the code of a component that must not
 *                                                           have effects, and its EFFECT handlers
 *   runRoots(project)                       → Array<Root>   views `run()` is given that have no statics
 *   moduleRoot(project, file)               → Root | null   a component file's top-level code
 *   effectFindings(project, root)           → Array<Finding>
 *   Root = { place, label, action?, comp?, file, node }
 *   Finding = { kind, code, site, file, effects: [{ name, kind, file, node, via }] }
 *
 * What is found: calls and writes of browser APIs reached from globals (`fetch`, `window.fetch`,
 * `window['fetch']`, a const alias, a destructured `sendBeacon`, `.call` / `.apply` / `.bind`, a
 * string the checker can fold), DOM writes on anything rooted in `document` or an event target,
 * calls into a short list of HTTP, storage and telemetry packages, and writes to module-level
 * variables. Reads (location.href, localStorage.getItem) are inputs, not outputs: not reported.
 *
 * What is followed: functions the code calls, hands over as an argument, property or JSX
 * attribute, renders as a tag (a component with statics is checked as itself), or reads as a
 * getter, in this file and through relative imports, to any depth (a visited set stops cycles).
 * Nested functions count: a callback defined in a view or a reducer is assumed to run. An effect
 * in a helper is reported where the root calls it, so a rule stays per-file; `// sygnal-ignore`
 * works at the call or at the effect.
 */
import { walk, unwrap, isFunction, propName, memberName, stringValue, jsxName, jsxAttrExpr } from '../ast.js'
import { findBinding } from '../scope.js'
import { resolveExpr } from './resolve.js'
import { evalStrings, DYN } from '../strings.js'
import { splitModelKey } from './modelEntries.js'

const GLOBAL_OBJECTS = new Set(['globalThis', 'window', 'self', 'top', 'parent', 'frames'])

const TABLE = new Map()
const add = (kind, ...names) => { for (const n of names) TABLE.set(n, kind) }
const storage = ['localStorage', 'sessionStorage'].flatMap(s => ['setItem', 'removeItem', 'clear'].map(m => `${s}.${m}`))
add('network', 'fetch', 'navigator.sendBeacon', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'WebTransport', 'RTCPeerConnection', 'Image')
add('storage', ...storage, 'indexedDB.open', 'indexedDB.deleteDatabase', 'caches.open', 'caches.delete', 'cookieStore.set', 'cookieStore.delete')
add('navigation', 'location.assign', 'location.replace', 'location.reload', 'open', 'history.pushState', 'history.replaceState', 'history.back', 'history.forward', 'history.go')
add('timer', 'setTimeout', 'setInterval', 'setImmediate', 'requestAnimationFrame', 'requestIdleCallback', 'queueMicrotask', 'clearTimeout', 'clearInterval', 'cancelAnimationFrame', 'cancelIdleCallback')
add('message', 'postMessage', 'BroadcastChannel', 'Worker', 'SharedWorker', 'navigator.serviceWorker.register')
add('dom', 'addEventListener', 'removeEventListener', 'dispatchEvent', 'scrollTo', 'scrollBy', 'scroll', 'alert', 'confirm', 'prompt', 'print', 'focus', 'blur')
add('device', 'navigator.clipboard.writeText', 'navigator.clipboard.write', 'navigator.share', 'navigator.vibrate', 'Notification', 'navigator.geolocation.getCurrentPosition', 'navigator.geolocation.watchPosition')
add('dynamic', 'eval', 'Function')

// Calls on these packages are effects; anything else in node_modules can't be seen (see the research README)
const PACKAGES = [
  ['network', /^(axios|ky|ofetch|wretch|superagent|redaxios|got|node-fetch|cross-fetch|posthog-js|mixpanel-browser|@amplitude\/.*|@segment\/.*|@sentry\/.*)$/],
  ['storage', /^(js-cookie|idb|idb-keyval|localforage|store2)$/],
]

const DOM_MUTATORS = new Set([
  'appendChild', 'append', 'prepend', 'remove', 'removeChild', 'insertBefore', 'replaceChild', 'replaceChildren', 'replaceWith', 'after', 'before',
  'insertAdjacentHTML', 'insertAdjacentElement', 'insertAdjacentText', 'setAttribute', 'removeAttribute', 'toggleAttribute', 'addEventListener', 'removeEventListener',
  'dispatchEvent', 'focus', 'blur', 'click', 'select', 'scrollIntoView', 'scrollTo', 'scrollBy', 'requestFullscreen', 'exitFullscreen', 'showModal', 'showPopover', 'hidePopover', 'togglePopover', 'submit', 'reset',
  'write', 'writeln', 'execCommand', 'add', 'toggle', 'setProperty', 'removeProperty',
])
const DETACHED = new Set(['createElement', 'createElementNS', 'createDocumentFragment', 'createTextNode', 'cloneNode'])
const EVENT_TARGETS = new Set(['target', 'currentTarget', 'srcElement'])
const ARRAY_MUTATORS = new Set(['push', 'pop', 'shift', 'unshift', 'splice', 'sort', 'reverse', 'fill', 'copyWithin'])
const COLLECTION_MUTATORS = new Set(['set', 'add', 'delete', 'clear'])

const isMember = (n) => n?.type === 'MemberExpression' || n?.type === 'OptionalMemberExpression'
const isCall = (n) => n?.type === 'CallExpression' || n?.type === 'OptionalCallExpression'

/** A member's property name, folding what the checker can (`'fe' + 'tch'`); null when dynamic. */
function foldedName(file, m) {
  const name = memberName(m)
  if (name != null) return name
  if (!m.computed) return null
  const lit = stringValue(m.property)
  if (lit != null) return lit
  const alts = evalStrings(m.property, { fileInfo: file })
  return alts.length === 1 && !alts[0].includes(DYN) ? alts[0] : null
}

/**
 * The path of a global an expression denotes: `window.navigator.sendBeacon` → ['navigator',
 * 'sendBeacon'], through const aliases and destructuring. `dynamic`: a computed key on a global
 * object that the checker can't fold. null: not rooted in a global.
 */
function globalPath(project, file, node, depth = 0) {
  const n = unwrap(node)
  if (!n || depth > 8) return null
  if (n.type === 'Identifier') {
    const b = findBinding(file, n.name, n)
    if (!b) return { path: GLOBAL_OBJECTS.has(n.name) ? [] : [n.name] }
    if (b.kind === 'pattern') return patternPath(project, file, n.name, b, depth)
    if (b.kind !== 'var' && b.kind !== 'import') return null
    if (b.kind === 'var' && !b.init) return null
    const r = resolveExpr(project, file, n)
    if (!r || r.node === n || (r.file === file && r.node.type === 'Identifier' && r.node.name === n.name)) return null
    return globalPath(project, r.file, r.node, depth + 1)
  }
  if (isMember(n)) {
    const base = globalPath(project, file, n.object, depth + 1)
    if (base?.dynamic) return base
    if (!base) {
      // const api = { send: window.fetch }; api.send()
      const name = memberName(n)
      const root = rootIdentifier(n)
      if (!name || !root || !findBinding(file, root.name, root)) return null
      const obj = resolveExpr(project, file, n.object)
      const p = obj?.node?.type === 'ObjectExpression' ? obj.node.properties.find(x => x.type === 'ObjectProperty' && propName(x) === name) : null
      return p ? globalPath(project, obj.file, p.value, depth + 1) : null
    }
    const name = foldedName(file, n)
    if (name != null) return { path: [...base.path, name] }
    return base.path.length ? { path: [...base.path, '*'] } : { path: [], dynamic: true }
  }
  if (n.type === 'LogicalExpression') return globalPath(project, file, n.left, depth + 1)
  if (isCall(n)) {
    // fetch.bind(window)
    const c = unwrap(n.callee)
    if (isMember(c) && memberName(c) === 'bind') return globalPath(project, file, c.object, depth + 1)
    // Reflect.get(window, name)
    if (isMember(c) && memberName(c) === 'get' && unwrap(c.object)?.type === 'Identifier' && unwrap(c.object).name === 'Reflect' && !findBinding(file, 'Reflect', c)) {
      const base = n.arguments[0] && globalPath(project, file, n.arguments[0], depth + 1)
      if (!base) return null
      const key = n.arguments[1] && stringValue(n.arguments[1])
      return key != null ? { path: [...base.path, key] } : { path: [], dynamic: true }
    }
  }
  return null
}

/** `const { sendBeacon: b } = navigator` */
function patternPath(project, file, name, b, depth) {
  const d = b.node
  if (d?.id?.type !== 'ObjectPattern' || !d.init) return null
  for (const p of d.id.properties) {
    if (p.type !== 'ObjectProperty') continue
    const v = p.value.type === 'AssignmentPattern' ? p.value.left : p.value
    if (v.type !== 'Identifier' || v.name !== name) continue
    const key = propName(p)
    const base = globalPath(project, file, d.init, depth + 1)
    return base && !base.dynamic && key != null ? { path: [...base.path, key] } : null
  }
  return null
}

const display = (path) => path.join('.')

function tableEffect(g) {
  let path = g.path
  if (path.length > 1 && ['call', 'apply'].includes(path[path.length - 1])) path = path.slice(0, -1)
  const key = display(path)
  const kind = TABLE.get(key)
  return kind ? { kind, name: key } : null
}

/** Is this rooted in the live document or an event's target? A detached element is not. */
function domRooted(file, node, depth = 0) {
  const n = unwrap(node)
  if (!n || depth > 8) return false
  if (n.type === 'Identifier') {
    const b = findBinding(file, n.name, n)
    if (!b) return n.name === 'document'
    return b.kind === 'var' && b.init ? domRooted(file, b.init, depth + 1) : false
  }
  if (isMember(n)) {
    const name = memberName(n)
    const obj = unwrap(n.object)
    if (obj?.type === 'Identifier') {
      const b = findBinding(file, obj.name, obj)
      if (!b && GLOBAL_OBJECTS.has(obj.name) && name === 'document') return true
      if (b?.kind === 'param' && EVENT_TARGETS.has(name)) return true
    }
    return domRooted(file, n.object, depth + 1)
  }
  if (isCall(n)) {
    const c = unwrap(n.callee)
    return isMember(c) && !DETACHED.has(memberName(c)) ? domRooted(file, c.object, depth + 1) : false
  }
  return false
}

/** `document.createElement('img')`, directly or through a local const: its `src` loads at once. */
function createsElement(file, node, depth = 0) {
  const n = unwrap(node)
  if (!n || depth > 4) return false
  if (n.type === 'Identifier') {
    const b = findBinding(file, n.name, n)
    return b?.kind === 'var' && b.init ? createsElement(file, b.init, depth + 1) : false
  }
  if (!isCall(n)) return false
  const c = unwrap(n.callee)
  return isMember(c) && memberName(c) === 'createElement'
}

function rootIdentifier(node) {
  let n = unwrap(node)
  while (isMember(n)) n = unwrap(n.object)
  return n?.type === 'Identifier' ? n : null
}

/** A binding declared at the top level of its file, or null. */
function moduleBinding(file, ident) {
  const b = findBinding(file, ident.name, ident)
  if (!b) return null
  if (b.kind === 'import') return b.source.startsWith('.') ? b : null
  if (b.kind !== 'var' && b.kind !== 'pattern') return null
  const decl = file.parents.get(b.node)
  let p = file.parents.get(decl)
  if (p?.type === 'ExportNamedDeclaration') p = file.parents.get(p)
  return p?.type === 'Program' ? b : null
}

function classifyWrite(project, file, target, n) {
  const left = unwrap(target)
  if (left?.type === 'Identifier') {
    const b = findBinding(file, left.name, left)
    if (!b) return { kind: 'dom', name: left.name, write: true }
    const mb = moduleBinding(file, left)
    return mb ? { kind: 'module', name: left.name, write: true } : null
  }
  if (!isMember(left)) return null
  const g = globalPath(project, file, left)
  if (g?.dynamic) return { kind: 'dynamic', name: 'a computed property of a global object' }
  if (g) {
    const [head] = g.path
    const name = display(g.path)
    if (head === 'location') return { kind: 'navigation', name }
    if (name === 'document.cookie') return { kind: 'storage', name, cookie: true }
    if (head === 'localStorage' || head === 'sessionStorage') return { kind: 'storage', name }
    if (head === 'document' || g.path.length === 1) return { kind: 'dom', name, write: true }
    if (domRooted(file, left.object)) return { kind: 'dom', name, write: true }
    return null
  }
  if (domRooted(file, left.object)) return { kind: 'dom', name: file.source.slice(n.start, n.end).split('=')[0].trim().slice(0, 50), write: true }
  if (memberName(left) === 'src' && createsElement(file, left.object)) return { kind: 'network', name: 'the src of a created element' }
  const root = rootIdentifier(left)
  if (root && moduleBinding(file, root)) return { kind: 'module', name: root.name, write: true }
  return null
}

function classifyCall(project, file, n) {
  const callee = unwrap(n.callee)
  if (callee?.type === 'Import') return classifyImport(file, n.arguments[0])
  const g = globalPath(project, file, callee)
  if (g?.dynamic) return { kind: 'dynamic', name: 'a computed property of a global object' }
  if (g) {
    const e = tableEffect(g)
    if (e) return e
  }
  if (isMember(callee)) {
    const method = memberName(callee)
    if (method === 'postMessage') return { kind: 'message', name: 'postMessage' }
    if (method && DOM_MUTATORS.has(method) && domRooted(file, callee.object)) return { kind: 'dom', name: `${g ? display(g.path) : `….${method}`}` }
  }
  const root = rootIdentifier(callee)
  if (root) {
    const b = findBinding(file, root.name, root)
    if (b?.kind === 'import') for (const [kind, re] of PACKAGES) if (re.test(b.source)) return { kind, name: `${b.source}: ${file.source.slice(callee.start, callee.end)}` }
    if (isMember(callee) && b && (b.kind === 'var' || b.kind === 'pattern') && moduleBinding(file, root) && unwrap(callee.object) === root) {
      const method = memberName(callee)
      if (method && moduleCollection(b, method) && !isMemo(file, n, root, method)) return { kind: 'module', name: `${root.name}.${method}`, write: true }
    }
  }
  return null
}

/** A mutating method called on a module-level array, Map or Set. */
function moduleCollection(b, method) {
  const init = unwrap(b.init)
  if (!init) return false
  if (init.type === 'ArrayExpression') return ARRAY_MUTATORS.has(method)
  if (init.type === 'NewExpression' && unwrap(init.callee)?.type === 'Identifier') {
    const c = unwrap(init.callee).name
    if (c === 'Array') return ARRAY_MUTATORS.has(method)
    if (c === 'Map' || c === 'Set' || c === 'WeakMap' || c === 'WeakSet') return COLLECTION_MUTATORS.has(method)
  }
  return false
}

/** `cache.has(k) ? … : cache.set(k, v)` in one function: the write memoizes what the same function reads. */
function isMemo(file, call, root, method) {
  if (!COLLECTION_MUTATORS.has(method)) return false
  let fn = call
  while (fn && !isFunction(fn)) fn = file.parents.get(fn)
  let found = false
  if (fn) walk(fn.body, (n) => {
    if (found) return false
    if (isCall(n)) {
      const c = unwrap(n.callee)
      if (isMember(c) && unwrap(c.object)?.name === root.name && ['get', 'has'].includes(memberName(c))) found = true
    }
    return true
  })
  return found
}

function classifyImport(file, arg) {
  const s = stringValue(arg)
  if (s != null) return /^(https?:)?\/\//.test(s) ? { kind: 'network', name: `import('${s}')` } : null
  // import(`./pages/${name}.js`) stays in the bundle; a value with no static prefix can be anything
  const n = unwrap(arg)
  if (n?.type === 'TemplateLiteral' && /^\.{0,2}\//.test(n.quasis[0].value.cooked)) return null
  return { kind: 'network', name: 'import() of a computed URL' }
}

/** What calling / reading `node` runs, in this project: a function, { file, node }, or null. */
function functionOf(project, file, node) {
  const n = unwrap(node)
  if (!n) return null
  if (n.type === 'Identifier') {
    const b = findBinding(file, n.name, n)
    if (!b || b.kind === 'param' || b.kind === 'pattern') return null
  } else if (isMember(n)) {
    const name = memberName(n)
    if (name && unwrap(n.object)?.type === 'NewExpression') return classMember(project, { file, node: unwrap(n.object) }, name)
    const root = rootIdentifier(n)
    if (!name || !root) return null
    const b = findBinding(file, root.name, root)
    if (!b || b.kind === 'param') return null
    const direct = resolveExpr(project, file, n)
    if (direct && isFunction(direct.node)) return { file: direct.file, node: direct.node }
    const obj = resolveExpr(project, file, n.object)
    const method = classMember(project, obj, name)
    if (method) return method
    const p = obj?.node?.type === 'ObjectExpression' ? obj.node.properties.find(x => x.type !== 'SpreadElement' && propName(x) === name) : null
    if (!p) return null
    if (p.type === 'ObjectMethod') return { file: obj.file, node: p }
    return functionOf(project, obj.file, p.value)
  } else return null
  const r = resolveExpr(project, file, n)
  if (r && isFunction(r.node)) return { file: r.file, node: r.node }
  if (r?.node?.type === 'ClassDeclaration' || r?.node?.type === 'ClassExpression') {
    const ctor = r.node.body.body.find(m => m.type === 'ClassMethod' && m.kind === 'constructor')
    return ctor ? { file: r.file, node: ctor } : null
  }
  return null
}

/** `new T().m()`, `const t = new T(); t.m()`, `T.m()`: the method when the class is in the project. */
function classMember(project, obj, name) {
  let cls = obj
  if (cls?.node?.type === 'NewExpression') cls = resolveExpr(project, cls.file, cls.node.callee)
  if (cls?.node?.type !== 'ClassDeclaration' && cls?.node?.type !== 'ClassExpression') return null
  const m = cls.node.body.body.find(x => x.type === 'ClassMethod' && propName(x) === name)
  return m ? { file: cls.file, node: m } : null
}

/** A getter `obj.name` reads, when obj is a literal the checker can see. */
function getterOf(project, file, m) {
  const name = memberName(m)
  const root = rootIdentifier(m)
  if (!name || !root || unwrap(m.object) !== root) return null
  const b = findBinding(file, root.name, root)
  if (!b || (b.kind !== 'var' && b.kind !== 'import')) return null
  const obj = resolveExpr(project, file, m.object)
  if (obj?.node?.type !== 'ObjectExpression') return null
  const p = obj.node.properties.find(x => x.type === 'ObjectMethod' && x.kind === 'get' && propName(x) === name)
  return p ? { file: obj.file, node: p } : null
}

const VALUE_POSITIONS = new Set(['CallExpression', 'OptionalCallExpression', 'NewExpression', 'ObjectProperty', 'JSXExpressionContainer', 'ArrayExpression', 'AssignmentExpression'])

/** One function or expression's direct effects, and the functions it reaches. */
function analyze(project, file, root) {
  const memo = memoOf(project)
  let a = memo.get(root)
  if (a) return a
  a = { effects: [], edges: [] }
  memo.set(root, a)
  const note = (e, node) => { if (e) a.effects.push({ ...e, node, file }) }
  const edge = (site, target) => { if (target && target.node !== root) a.edges.push({ site, target }) }
  const start = isFunction(root) ? root.body : root
  const visit = (n, parent) => {
    switch (n.type) {
      case 'CallExpression':
      case 'OptionalCallExpression':
      case 'NewExpression': {
        const e = classifyCall(project, file, n)
        if (e) note(e, n)
        else edge(n, functionOf(project, file, n.callee))
        break
      }
      case 'ImportExpression':
        note(classifyImport(file, n.source), n)
        break
      case 'ObjectProperty':
      case 'ObjectMethod':
        if (propName(n) === 'EFFECT' && root !== n) return false // (a local behavior's own EFFECT handler)
        break
      case 'AssignmentExpression':
        note(classifyWrite(project, file, n.left, n), n)
        break
      case 'UpdateExpression':
        note(classifyWrite(project, file, n.argument, n), n)
        break
      case 'UnaryExpression':
        if (n.operator === 'delete') note(classifyWrite(project, file, n.argument, n), n)
        if (n.operator === 'typeof') return false
        break
      case 'JSXOpeningElement': {
        const name = jsxName(n.name)
        if (name && /^[A-Z]/.test(name) && !name.includes('.')) {
          const b = findBinding(file, name, n)
          const r = b && resolveExpr(project, file, { type: 'Identifier', name, start: n.start, end: n.end, loc: n.loc })
          if (r && isFunction(r.node)) edge(n.name, { file: r.file, node: r.node })
        }
        break
      }
      case 'Identifier':
      case 'MemberExpression':
      case 'OptionalMemberExpression': {
        if (isMember(n) && !(isCall(parent) && unwrap(parent.callee) === n)) {
          const g = getterOf(project, file, n)
          if (g) edge(n, g)
        }
        const value = parent && VALUE_POSITIONS.has(parent.type) && (parent.type === 'ObjectProperty' ? parent.value === n && file.parents.get(parent)?.type !== 'ObjectPattern'
          : parent.type === 'AssignmentExpression' ? parent.right === n : !(parent.callee && unwrap(parent.callee) === n))
        if (value) {
          const g = globalPath(project, file, n)
          const e = g && !g.dynamic ? tableEffect(g) : null
          if (e && (e.kind === 'network' || e.kind === 'timer')) note({ ...e, reference: true }, n)
          else edge(n, functionOf(project, file, n))
        }
        break
      }
    }
    return true
  }
  if (root !== start) for (const p of root.params || []) walk(p, visit)
  walk(start, visit, isFunction(root) ? root : null)
  return a
}

const MEMOS = new WeakMap()
function memoOf(project) {
  let m = MEMOS.get(project)
  if (!m) MEMOS.set(project, m = new WeakMap())
  return m
}

function suppressedAt(file, node, code) {
  const line = node?.loc?.start?.line
  for (const l of [line, line - 1]) {
    const s = file.suppressions.get(l)
    if (s === '*' || s?.has(code)) return true
  }
  return false
}

/** A tag or reference to a component with statics: it is checked as itself. */
const isOtherComponent = (project, ed) => !!project.componentForFunction(ed.target.node) && !isCall(ed.site)

/** Every effect reachable from an edge's target: [{ effect, via }] */
function reachable(project, target, seen, via, out) {
  if (seen.has(target.node)) return out
  seen.add(target.node)
  const a = analyze(project, target.file, target.node)
  for (const e of a.effects) out.push({ ...e, via })
  for (const ed of a.edges) if (!isOtherComponent(project, ed)) reachable(project, ed.target, seen, [...via, ed.target], out)
  return out
}

export const NETWORK = 'network'

/** The code a kind has in a pure place; EFFECT handlers only report network (SYG511). */
export function codeFor(kind, place) {
  if (place === 'effect') return kind === NETWORK ? 'SYG511' : null
  if (kind === 'module') return 'SYG512'
  return kind === NETWORK ? 'SYG265' : 'SYG266'
}

/**
 * The findings of a root, one per site and code: `site` is in `file` (the root's own code); a
 * helper's effects are listed in `effects`, each with where it is.
 */
export function effectFindings(project, root) {
  const { file, node, place } = root
  const a = analyze(project, file, node)
  const byKey = new Map()
  const push = (site, siteFile, e, via) => {
    const code = codeFor(e.kind, place)
    if (!code || suppressedAt(e.file, e.node, code)) return
    const key = `${site.start}:${code}`
    let f = byKey.get(key)
    if (!f) byKey.set(key, f = { code, site, file: siteFile, kind: e.kind, effects: [] })
    if (!f.effects.some(x => x.node === e.node)) f.effects.push({ ...e, via })
  }
  for (const e of a.effects) push(e.node, file, e, [])
  for (const ed of a.edges) {
    if (isOtherComponent(project, ed)) continue
    const seen = new Set([node])
    for (const r of reachable(project, ed.target, seen, [ed.target], [])) push(ed.site, file, r, r.via)
  }
  return [...byKey.values()].sort((x, y) => x.site.start - y.site.start)
}

/** Properties of an object literal, through spreads of objects the checker can resolve. */
function entriesOf(project, file, obj, depth = 0) {
  const out = []
  if (depth > 6) return out
  for (const p of obj.properties) {
    if (p.type === 'SpreadElement') {
      const r = resolveExpr(project, file, p.argument)
      if (r?.node?.type === 'ObjectExpression') out.push(...entriesOf(project, r.file, r.node, depth + 1))
      continue
    }
    const key = propName(p)
    if (key != null) out.push({ key, value: p.type === 'ObjectMethod' ? p : unwrap(p.value), file })
  }
  return out
}

// what top-level code of a component file may not do; a page script's DOM wiring is its own business
const MODULE_KINDS = new Set(['network', 'storage', 'navigation', 'message'])

const NAME = (s) => `'${s}'`

/** Resolve a handler value to what runs: a function, or the expression itself (`set(fn)`). */
function handlerNode(project, file, value) {
  if (isFunction(value)) return { file, node: value }
  const r = resolveExpr(project, file, value)
  return r?.node ? { file: r.file, node: r.node } : null
}

function modelRoots(project, comp) {
  const out = []
  const m = comp.staticProps.model && resolveExpr(project, comp.file, comp.staticProps.model)
  if (m?.node?.type !== 'ObjectExpression') return out
  const addHandler = (action, sink, file, value) => {
    const h = handlerNode(project, file, value)
    if (!h) return
    const place = sink === 'EFFECT' ? 'effect' : sink === 'STATE' ? 'state' : 'sink'
    out.push({ place, action, comp, file: h.file, node: h.node,
      label: sink === 'STATE' ? `the STATE reducer for ${NAME(action)}` : `the ${sink} handler of ${NAME(action)}` })
  }
  for (const e of entriesOf(project, m.file, m.node)) {
    const { action, sink, shorthand } = splitModelKey(e.key)
    if (shorthand) { addHandler(action, sink, e.file, e.value); continue }
    const v = e.value.type === 'ObjectMethod' ? null : resolveExpr(project, e.file, e.value)
    if (v?.node?.type === 'ObjectExpression') for (const s of entriesOf(project, v.file, v.node)) addHandler(action, s.key, s.file, s.value)
    else addHandler(action, 'STATE', e.file, e.value)
  }
  return out
}

const DECLARATION_STATICS = ['initialState', 'isolatedState', 'resources', 'timers', 'connections', 'head', 'route', 'persist', 'browser', 'uses', 'agent']

/** The code of a component that must be free of effects, plus its EFFECT handlers. */
export function effectRoots(project, comp) {
  const sp = comp.staticProps
  const name = comp.name
  const out = []
  if (comp.view) out.push({ place: 'view', comp, file: comp.file, node: comp.view, label: `the view of ${NAME(name)}` })
  if (sp.intent) {
    const r = handlerNode(project, comp.file, sp.intent)
    if (r) out.push({ place: 'intent', comp, ...r, label: `the intent of ${NAME(name)}` })
  }
  out.push(...modelRoots(project, comp))
  for (const [prop, entries, what] of [['calculated', comp.calculatedEntries, 'calculated field'], ['context', comp.contextEntries, 'context entry']]) {
    if (!sp[prop]) continue
    if (entries) for (const [key, e] of entries) { const h = handlerNode(project, e.file, e.node); if (h) out.push({ place: prop, comp, ...h, label: `the ${what} ${NAME(key)} of ${NAME(name)}` }) }
    else { const h = handlerNode(project, comp.file, sp[prop]); if (h) out.push({ place: prop, comp, ...h, label: `the ${prop} static of ${NAME(name)}` }) }
  }
  for (const prop of DECLARATION_STATICS) {
    if (!sp[prop]) continue
    const h = handlerNode(project, comp.file, sp[prop])
    if (h && h.node.type !== 'StringLiteral') out.push({ place: 'static', comp, ...h, label: `the ${prop} static of ${NAME(name)}` })
  }
  return out
}

const isSygnalRun = (file, n) => {
  const c = unwrap(n.callee)
  if (c?.type !== 'Identifier' || c.name !== 'run') return false
  const b = findBinding(file, 'run', c)
  return b?.kind === 'import' && /^sygnal(\/|$)/.test(b.source)
}

/** A view `run()` is given that has no statics: nothing else makes it a component. */
export function runRoots(project) {
  const out = []
  for (const p of project.scanned) {
    const file = project.files.get(p)
    if (!file) continue
    walk(file.ast.program, (n) => {
      if (n.type === 'CallExpression' && isSygnalRun(file, n) && n.arguments[0]) {
        const r = resolveExpr(project, file, n.arguments[0])
        if (r && isFunction(r.node) && !project.componentForFunction(r.node)) {
          out.push({ place: 'view', file: r.file, node: r.node, label: `the view ${NAME(unwrap(n.arguments[0]).name || 'App')}` })
        }
      }
      return true
    })
  }
  return out
}

/** A component file's top-level code, without its functions: it runs on import, in no output. */
export function moduleRoot(project, file) {
  if (!file.components.length) return null
  const a = { effects: [], edges: [] }
  const memo = memoOf(project)
  for (const stmt of file.ast.program.body) {
    if (stmt.type === 'ImportDeclaration' || isFunction(stmt) || stmt.type === 'ClassDeclaration') continue
    if (stmt.type === 'ExportNamedDeclaration' && (isFunction(stmt.declaration) || stmt.declaration?.type === 'ClassDeclaration')) continue
    if (stmt.type === 'ExportDefaultDeclaration' && (isFunction(stmt.declaration) || stmt.declaration?.type === 'ClassDeclaration')) continue
    if (stmt.type === 'ExpressionStatement' && isStaticAssignment(file, stmt)) continue
    walk(stmt, (n, parent) => {
      if (isFunction(n) && !(isCall(parent) && unwrap(parent.callee) === n)) return false // (an IIFE runs now)
      if (n.type === 'CallExpression' || n.type === 'NewExpression') {
        const e = classifyCall(project, file, n)
        if (e && MODULE_KINDS.has(e.kind)) a.effects.push({ ...e, node: n, file })
      } else if (n.type === 'AssignmentExpression') {
        const e = classifyWrite(project, file, n.left, n)
        if (e && MODULE_KINDS.has(e.kind)) a.effects.push({ ...e, node: n, file })
      }
      return true
    })
  }
  if (!a.effects.length) return null
  const key = file.ast.program
  memo.set(key, a)
  return { place: 'module', file, node: key, label: `top-level code of a component file` }
}

function isStaticAssignment(file, stmt) {
  const e = unwrap(stmt.expression)
  return e.type === 'AssignmentExpression' && isMember(e.left) && file.components.some(c => Object.values(c.staticProps).includes(e.right))
}

// --------------------------------------------------------------------------- the words

const WHAT = {
  network: 'a network request',
  storage: 'a storage write',
  navigation: 'a navigation',
  timer: 'a timer',
  message: 'a message to another context',
  dom: 'a change to the page outside the view',
  device: 'a device API call',
  dynamic: 'dynamic code or a computed global, which the checker cannot read',
  module: 'a write to a module-level variable',
}

function netFix(names) {
  if (names.some(n => /WebSocket|EventSource/.test(n))) return 'declare it in the `connections` static with `makeSocketDriver()`; a socket message goes out through the sink: `ACTION: { WS: (state, data) => ({ to, json }) }`'
  return 'return the request from an HTTP sink: `ACTION: { HTTP: (state, data) => ({ url, method: \'POST\', json, ok: \'SAVED\' }) }` with `makeFetchDriver()`, or a `resources` entry for data the component shows; another kind of output gets a driver of its own'
}

function domFix(names) {
  if (names.some(n => /addEventListener/.test(n))) return 'listen in the intent, `DOM.select(\'document\').events(\'keydown\')`, or declare it in the `browser` static (`makeBrowserDriver()`)'
  if (names.some(n => n === 'document.title')) return 'set it from the `head` static: `App.head = (state) => ({ title: state.title })`'
  return 'send an `ELEMENT` command from a model entry (focus, blur, scrollIntoView, select, click), render the change from state, or put it in an EFFECT entry; `<Portal>` renders outside the root'
}

export function fixFor(kind, names) {
  switch (kind) {
    case 'network': return netFix(names)
    case 'storage': return names.some(n => n === 'document.cookie')
      ? 'write it from an EFFECT entry: `ACTION: { EFFECT: (state, data) => { document.cookie = … } }`, so it is a declared output'
      : 'declare it with the `persist` static, or write it from an EFFECT entry: `ACTION: { EFFECT: (state, data) => { localStorage.setItem(…) } }`'
    case 'navigation': return 'send it through the router: `ACTION: { ROUTER: (state, data) => ({ to: \'/path\' }) }` with `makeRouter()`, or put it in an EFFECT entry'
    case 'timer': return 'declare it in the `timers` static, or use `next(\'ACTION\', data, delayMs)` in a model entry; a frame loop is a `frame` timer'
    case 'message': return 'send it through a driver sink (`ACTION: { MESSAGES: (state, data) => … }`), or put it in an EFFECT entry'
    case 'dom': return domFix(names)
    case 'device': return 'call it from an EFFECT entry, or a driver sink if it answers'
    case 'dynamic': return 'write the name out and move the call to a model output (HTTP, EFFECT or a driver sink), so it can be read without running it'
    default: return 'keep it in state; for a pure memo, add `// sygnal-ignore SYG512` at the write'
  }
}

const relName = (project, f) => project.relPath(f.path)

/** The report fields of one finding. */
export function effectReport(project, root, f) {
  const names = [...new Set(f.effects.map(e => e.name))]
  const direct = f.effects.every(e => !e.via.length)
  const shown = names.slice(0, 3).map(n => `\`${n}\``).join(', ') + (names.length > 3 ? ` and ${names.length - 3} more` : '')
  const callText = f.file.source.slice(f.site.start, f.site.end).split('\n')[0].slice(0, 50)
  const what = WHAT[f.kind]
  const message = f.code === 'SYG511'
    ? `${root.label} calls ${shown}${direct ? '' : ` through \`${callText}\``}, so the request bypasses the HTTP driver: no abort when superseded, no reply action, and tests can't answer it`
    : `${root.label} ${direct ? `runs ${shown}` : `calls \`${callText}\`, which runs ${shown}`}: ${what} that no model entry declares`
  const related = direct ? undefined : f.effects.filter(e => e.via.length).slice(0, 5).map(e => ({ file: e.file, node: e.node, message: `${e.name} is here (${relName(project, e.file)})` }))
  return {
    code: f.code,
    component: root.comp?.name,
    file: f.file,
    node: f.site,
    message,
    fix: fixFor(f.kind, names),
    related,
    data: { place: root.place, kind: f.kind, action: root.action, effects: names },
  }
}
