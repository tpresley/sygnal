/**
 * Rename (PLAN-7 P4-5; spike 0-S3 §4): which occurrences a rename of a Sygnal name edits, or why
 * it refuses. Runs where the project is built (the language server's check worker, core.js), on
 * the open documents as they are now. Names are wired by strings, so a missed occurrence is a
 * dead action at runtime with no type error: every rule below errs on refusing.
 *
 *   planRename(prep, { file, line, column, newName? }) → Plan
 *     prep: core.js prepare() ({ project, options, srcs, substituted }) (files from the folder's
 *     config, the open documents as `sources`). file: absolute path; line/column 1-based.
 *     newName absent: prepareRename (the refusals only); present: the edits, validated.
 *   Plan =
 *     null                                   the position has no Sygnal name
 *     { refused: message }                   prepareRename / rename answer with this error
 *     { kind, name, range, placeholder,      kind: 'action' | 'events' | 'class' | 'id' | 'state' |
 *       edits?, tests?, warnings? }          'context'; range (Range of positions.js): the
 *                                            occurrence at the cursor; edits: [Range & { file,
 *                                            newText, group: 'code' | 'agent' }]; tests: the same
 *                                            for test files (group 'test'); warnings: strings
 *
 * Renamable, with what is edited:
 *   action   every occurrence in its component(s) (intent, model, next(), reply names, statics,
 *            agent.actions keys: group 'agent', behavior options; a model / intent object shared by
 *            components: every component sharing it); a user behavior's action ('form.SUBMIT')
 *            when its definition has one host and key
 *   events   every emit and select in the project
 *   class/id the view tokens and intent selectors of the DOM scopes they resolve to
 *   state    the initialState / calculated key and Collection `from` uses
 *   context  the providers' entries and the reads resolving to them
 * Refusals: see REFUSALS in the README ("Rename"); the messages say why.
 *
 * Guards for every kind:
 *   - every file parses (a file checked with its last good text would hide uses);
 *   - the text at every edit is the name (or its bare part in a behavior's definition);
 *   - no other mention: a string literal, property key or member name (`.NAME`) with the name in
 *     the project's source that the index doesn't account for refuses (sygnal-check can't tell
 *     whether it's the same name: `simulate('SAVE')`, `state.items`, `querySelector('.card')`);
 *     for classes and ids also the folder's style and markup files (CSS isn't renamed);
 *   - test files (*.test.* / *.spec.*, found under the folder) are never in the project's
 *     guard: their mentions become the `tests` group, offered for confirmation.
 */
import fs from 'node:fs'
import path from 'node:path'
import { walk, parseSource } from '../ast.js'
import { buildIndex, createLookup } from './positions.js'
import { BUILTIN_ACTIONS } from './modelEntries.js'
import { expandInputs, resolveImport } from '../files.js'
import { CLASS_HELPERS } from '../strings.js'

export const TEST_FILE = /\.(test|spec)\.[cm]?[jt]sx?$/
const STYLE_FILE = /\.(css|scss|sass|less|styl|pcss|postcss|html?|vue|svelte|astro)$/
const IGNORED_DIRS = new Set(['node_modules', 'dist', 'build', 'coverage', '.git', '.astro', '.vite', '.next', '.svelte-kit', '.turbo', 'out'])
const IDENT = /^[A-Za-z_$][\w$]*$/
const SCREAMING = /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*$/
const CSS_IDENT = /^-?[_a-zA-Z][_a-zA-Z0-9-]*$/
const ID_ATTRS = new Set(['id', 'for', 'htmlFor', 'list', 'form', 'headers', 'popovertarget', 'anchor', 'aria-labelledby', 'aria-describedby', 'aria-controls', 'aria-owns', 'aria-activedescendant', 'aria-details', 'aria-errormessage', 'aria-flowto'])
const CLASS_ATTRS = new Set(['class', 'className'])
const DYN_FLAGS = [
  ['intentUnknown', 'its intent is built in a way sygnal-check can\'t read (a spread, computed keys or a function it can\'t see)'],
  ['modelUnknown', 'its model is built with a spread or computed keys, so not every use can be found'],
  ['dynamicNext', 'it calls next() with a name built at run time'],
  ['dynamicReplies', 'a request names its reply action at run time'],
  ['dynamicConnections', 'a connection / resource / route / timer names its action at run time'],
]

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const rel = (prep, f) => path.relative(prep.folder || process.cwd(), f) || f
const at = (prep, o) => `${rel(prep, o.file)}:${o.line}`
const refuse = (refused) => ({ refused })

export function planRename(prep, { file, line, column, newName = null, folder } = {}) {
  const { project } = prep
  prep = { ...prep, folder }
  // every file must parse: a file checked with its last good text (or not at all) hides uses
  const broken = [...prep.substituted.keys(), ...project.parseErrors.map(e => e.file)]
  for (const f of project.files.values()) if (f?.ast?.errors?.length) broken.push(f.path)
  const index = buildIndex(project)
  const lookup = createLookup(index)
  const here = lookup.at(file, line, column)
  if (!here.length) return broken.includes(file) ? refuse(`can't rename here: ${path.basename(file)} has a syntax error`) : null
  if (broken.length) return refuse(`can't rename while ${rel(prep, [...new Set(broken)][0])} has a syntax error: its uses can't be found`)

  const cur = here[0]
  const ctx = { prep, project, index, lookup, here, cur, newName, comps: new Map(index.components.map(c => [c.id, c])) }
  const range = pick(cur)
  const placeholder = sourceOf(project, cur.file).slice(cur.start, cur.end)
  let plan
  switch (cur.ns) {
    case 'control': return refuse(`<${cur.name}> is a control (an identifier): rename it with TypeScript's rename`)
    case 'child': return refuse(cur.kind === 'parent' ? 'PARENT is a sink name; it can\'t be renamed' : `${cur.name} is a component (an identifier): rename it with TypeScript's rename`)
    case 'dom': plan = planDom(ctx); break
    case 'state': plan = planState(ctx); break
    case 'context': plan = planContext(ctx); break
    default: plan = cur.role === 'emit' || cur.role === 'select' ? planEvents(ctx) : planAction(ctx)
  }
  if (plan.refused) return plan
  plan = { ...plan, range, placeholder }
  const done = finish(ctx, plan)
  if (done.refused) return done
  // plain data (the plan crosses the worker boundary)
  const { kind, name, edits, tests, warnings, newName: value } = done
  return { kind, name, range, placeholder, ...(edits ? { newName: value, edits, tests, warnings } : {}) }
}

const pick = (o) => ({ start: o.start, end: o.end, line: o.line, column: o.column, endLine: o.endLine, endColumn: o.endColumn })
const sourceOf = (project, abs) => project.files.get(abs)?.source ?? ''
const compName = (ctx, id) => ctx.comps.get(id)?.name || id
const sameRange = (a, b) => a.file === b.file && a.start === b.start && a.end === b.end
const isEventOcc = (o) => !o.ns && (o.role === 'emit' || o.role === 'select')

// ---------------------------------------------------------------- actions

function planAction(ctx) {
  const { index, here, cur } = ctx
  const name = cur.name
  for (const o of here) {
    if (o.builtin || BUILTIN_ACTIONS.has(o.name)) return refuse(`${o.name} is built in: its name is fixed`)
    if (o.synthetic) return refuse(`${o.name} is added by undoable(): its name is fixed`)
    if (o.kind === 'uses') return refuse(`this is the key of a behavior (uses.${o.behavior}): its actions are named '${o.behavior}.X'; renaming the key isn't supported`)
    if (o.firstParty) return refuse(`${o.name} belongs to the first-party behavior '${o.behavior}': its names are fixed`)
  }
  const actionOccs = index.occurrences.filter(o => !o.ns && !isEventOcc(o) && o.component)
  const byKey = new Map()
  for (const o of actionOccs) {
    const k = `${o.component}\0${o.name}`
    if (!byKey.has(k)) byKey.set(k, [])
    byKey.get(k).push(o)
  }
  // the closure: occurrences sharing a range (a shared model or intent, a behavior's definition)
  // bring in the other component's occurrences of that name
  const keys = new Set()
  const queue = here.filter(o => !o.ns && !isEventOcc(o) && o.component).map(o => `${o.component}\0${o.name}`)
  while (queue.length) {
    const k = queue.pop()
    if (keys.has(k)) continue
    keys.add(k)
    for (const o of byKey.get(k) || []) {
      if (o.kind === 'uses') continue // the key stands for every name of the behavior
      for (const x of actionOccs) if (x.kind !== 'uses' && sameRange(x, o) && !keys.has(`${x.component}\0${x.name}`)) queue.push(`${x.component}\0${x.name}`)
    }
  }
  const group = [...keys].flatMap(k => byKey.get(k) || [])
  const comps = [...new Set(group.map(o => o.component))]
  const names = [...new Set(group.map(o => o.name))]

  for (const o of group) {
    if (o.builtin || o.synthetic) return refuse(`${o.name} is ${o.builtin ? 'built in' : 'added by undoable()'}: its name is fixed`)
    if (o.firstParty) return refuse(`${o.name} belongs to the first-party behavior '${o.behavior}': its names are fixed`)
    if (o.constant) {
      const v = o.via?.[0]
      return refuse(`can't rename ${o.name}: it is built from a constant${v ? ` (${v.name} at ${at(ctx.prep, v)})` : ''} at ${at(ctx.prep, o)}; rename the constant's value by hand`)
    }
  }
  // a behavior's definition (file of its own) is shared by every host using it
  for (const o of group) {
    if (!o.kind.startsWith('behavior-') || o.kind === 'behavior-option') continue
    const hosts = new Set(actionOccs.filter(x => sameRange(x, o)).map(x => `${x.component}\0${x.behavior}`))
    if (hosts.size > 1) return refuse(`can't rename ${name}: the behavior's definition (${at(ctx.prep, o)}) is used by ${hosts.size} hosts or keys, and renaming would rename it for all of them`)
  }
  const reply = group.find(o => o.kind === 'behavior-reply')
  if (reply) return refuse(`can't rename ${name}: the behavior '${reply.behavior}' names it as a reply (${at(ctx.prep, reply)}), and sygnal-check can't tell whether that is the behavior's own action`)
  if (names.length > 1) return refuse(`can't rename ${name}: its occurrences are shared under several names (${names.join(', ')})`)
  for (const id of comps) {
    const c = ctx.comps.get(id)
    for (const [flag, why] of DYN_FLAGS) {
      if (c?.flags?.[flag]) return refuse(`can't rename ${name}: in ${c.name}, ${why}`)
    }
    if (name.includes('.') && c?.flags?.usesOpen) return refuse(`can't rename ${name}: ${c.name} uses a behavior whose actions can't be listed`)
  }
  const behavior = group.find(o => o.behavior && name.startsWith(o.behavior + '.'))?.behavior || null
  const bare = behavior ? name.slice(behavior.length + 1) : name
  return {
    kind: 'action', name, group, comps, behavior, bare,
    mentionNames: behavior ? [name] : [name],
    collide: (n) => {
      const full = behavior ? `${behavior}.${n}` : n
      if (BUILTIN_ACTIONS.has(full)) return `${full} is a built-in action`
      for (const id of comps) if (byKey.has(`${id}\0${full}`)) return `${compName(ctx, id)} already has an action ${full}`
      return null
    },
    validate: (n) => {
      const b = behavior && n.startsWith(behavior + '.') ? n.slice(behavior.length + 1) : n
      if (!IDENT.test(b)) return { error: `'${n}' isn't a valid action name: use an identifier (letters, digits, _ and $, not starting with a digit)` }
      return { value: b, warning: SCREAMING.test(b) ? null : `'${b}' isn't SCREAMING_SNAKE_CASE (the convention for action names)` }
    },
    newTextFor: (o, text, v) => {
      if (text === name) return behavior ? `${behavior}.${v}` : v
      if (behavior && text === bare) return v
      return null
    },
  }
}

// ---------------------------------------------------------------- EVENTS

function planEvents(ctx) {
  const { index, cur } = ctx
  const name = cur.name
  const group = index.occurrences.filter(o => isEventOcc(o) && o.name === name)
  if (group.some(o => o.implicit)) return refuse(`EVENTS '${name}' is selected by sygnal/ui's Toaster: its name is fixed`)
  const { dynamicSelected, dynamicEmitted } = index.flags
  if (dynamicSelected || dynamicEmitted) {
    const what = [dynamicSelected && `${dynamicSelected} EVENTS select(s)`, dynamicEmitted && `${dynamicEmitted} emit(s)`].filter(Boolean).join(' and ')
    return refuse(`can't rename EVENTS '${name}': the project has ${what} with a type built at run time, and any of them could be '${name}'`)
  }
  // EVENTS are project-wide: an intent or model that can't be read in full might select or emit it
  const c = group.find(o => o.constant)
  if (c) return refuse(`can't rename EVENTS '${name}': it is built from a constant${c.via?.[0] ? ` (${c.via[0].name} at ${at(ctx.prep, c.via[0])})` : ''} at ${at(ctx.prep, c)}; rename the constant's value by hand`)
  const opaque = index.components.find(k => k.flags?.intentUnknown || k.flags?.modelUnknown)
  if (opaque) return refuse(`can't rename EVENTS '${name}': ${opaque.name}'s ${opaque.flags.modelUnknown ? 'model' : 'intent'} can't be read in full (spreads, computed keys), and it might ${opaque.flags.modelUnknown ? 'emit' : 'select'} '${name}'`)
  const types = new Set(index.occurrences.filter(isEventOcc).map(o => o.name))
  return {
    kind: 'events', name, group, mentionNames: [name],
    collide: (n) => types.has(n) ? `EVENTS '${n}' already exists` : null,
    validate: (n) => {
      if (!n.trim()) return { error: 'an EVENTS type can\'t be empty' }
      if (/['"`\\\n\r\u2028\u2029]|\$\{/.test(n)) return { error: `'${n}' has a quote, a backslash or a line break: rename it by hand` }
      return { value: n }
    },
    newTextFor: (o, text, v) => text === name ? v : null,
  }
}

// ---------------------------------------------------------------- class / id tokens

function planDom(ctx) {
  const { index, cur, project } = ctx
  const { kind, name } = cur
  const show = (kind === 'id' ? '#' : '.') + name
  const same = index.occurrences.filter(o => o.ns === 'dom' && o.kind === kind && o.name === name)
  const flag = kind === 'id' ? 'dynamicIds' : 'dynamicClasses'
  if (cur.role === 'selector' && cur.behavior) return refuse(`can't rename '${show}' here: it is a selector in an option of the behavior '${cur.behavior}'`)
  if (cur.role === 'selector' && cur.childScope) return refuse(`can't rename '${show}': it is only rendered inside the child component <${cur.child}>, which ${compName(ctx, cur.component)} can't see`)
  // the closure over scopes: a render's scope → the selectors resolving to it → their scopes
  const scopes = new Set(cur.role === 'selector' ? cur.scopes || [] : [cur.scope])
  const group = new Set()
  let grew = true
  while (grew) {
    grew = false
    for (const o of same) {
      if (group.has(o)) continue
      const hit = o.role === 'render' ? scopes.has(o.scope) : (o.scopes || []).some(s => scopes.has(s)) || scopes.has(o.childScope)
      if (!hit) continue
      group.add(o)
      grew = true
      if (o.role === 'selector' && !o.childScope) for (const s of o.scopes || []) scopes.add(s)
    }
  }
  if (cur.role === 'selector' && ![...group].some(o => o.role === 'render')) {
    return refuse(`can't rename '${show}': ${compName(ctx, cur.component)}'s view doesn't render it${cur.dynamic ? ` (it has dynamic ${kind === 'id' ? 'ids' : 'class names'})` : ''}`)
  }
  for (const o of group) {
    if (o.role === 'selector' && o.behavior) return refuse(`can't rename '${show}': the behavior '${o.behavior}' of ${compName(ctx, o.component)} selects it through an option`)
    const c = ctx.comps.get(o.component)
    if (c?.flags?.[flag]) return refuse(`can't rename '${show}': ${c.name}'s view has dynamic ${kind === 'id' ? 'ids' : 'class names'}, which might produce it`)
    if (o.role === 'render') {
      const twice = same.filter(x => x.role === 'render' && sameRange(x, o)).length > 1
      if (twice) return refuse(`can't rename '${show}': it is written in a helper rendered in more than one view (${at(ctx.prep, o)})`)
      const decl = sharedConst(project, o)
      if (decl) return refuse(`can't rename '${show}': it is written in the module constant ${decl} (${at(ctx.prep, o)}), which may be used elsewhere`)
    }
  }
  if (![...group].some(o => o.role === 'selector')) return refuse(`can't rename '${show}': no intent selects it, so it is only styling or markup; rename it together with your CSS`)
  const outside = same.filter(o => !group.has(o))
  if (outside.length) {
    const where = [...new Set(outside.map(o => compName(ctx, o.component)))].slice(0, 3).join(', ')
    return refuse(`can't rename '${show}': it is also used outside this DOM scope (by ${where}, ${at(ctx.prep, outside[0])}); renaming one scope would split it`)
  }
  const existing = new Set(index.occurrences.filter(o => o.ns === 'dom' && o.kind === kind).map(o => o.name))
  return {
    kind, name, group: [...group], mentionNames: [name], dom: kind,
    collide: (n) => existing.has(n) ? `'${kind === 'id' ? '#' : '.'}${n}' is already used` : null,
    validate: (n) => {
      const v = n.replace(/^[.#]/, '')
      return CSS_IDENT.test(v) ? { value: v } : { error: `'${n}' isn't a valid CSS ${kind === 'id' ? 'id' : 'class name'} (letters, digits, - and _, not starting with a digit)` }
    },
    newTextFor: (o, text, v) => text === name ? v : null,
  }
}

/** The name of a module-level `const` whose initializer holds a view token, or null. */
function sharedConst(project, o) {
  const f = project.files.get(o.file)
  if (!f?.ast) return null
  let node = null
  walk(f.ast.program, (n) => {
    if (n.start > o.start || n.end < o.end) return false
    node = n
    return true
  })
  let decl = null
  for (let p = node; p; p = f.parents.get(p)) {
    if (p.type === 'VariableDeclarator') decl = p
    if (p.type === 'FunctionDeclaration' || p.type === 'FunctionExpression' || p.type === 'ArrowFunctionExpression' || p.type === 'ObjectMethod' || p.type === 'ClassMethod') return null
  }
  return decl ? (decl.id?.name || 'const') : null
}

// ---------------------------------------------------------------- state keys

function planState(ctx) {
  const { index, cur } = ctx
  const c = ctx.comps.get(cur.component)
  if (c?.flags?.stateUnknown) return refuse(`can't rename '${cur.name}': ${c.name}'s initialState is built in a way sygnal-check can't read`)
  if (c?.flags?.calculatedUnknown) return refuse(`can't rename '${cur.name}': ${c.name}'s calculated fields are built in a way sygnal-check can't read`)
  const group = index.occurrences.filter(o => o.ns === 'state' && o.component === cur.component && o.name === cur.name)
  if (!group.some(o => o.role === 'declare')) return refuse(`can't rename '${cur.name}': ${c?.name || 'the component'} has no initialState or calculated key '${cur.name}' (its state comes from its parent)`)
  const keys = new Set(index.occurrences.filter(o => o.ns === 'state' && o.component === cur.component && o.role === 'declare').map(o => o.name))
  return {
    kind: 'state', name: cur.name, group, comps: [cur.component], mentionNames: [cur.name], identifiers: true,
    collide: (n) => keys.has(n) ? `${c?.name} already has a state key '${n}'` : null,
    validate: (n) => IDENT.test(n) ? { value: n } : { error: `'${n}' isn't a valid state key: use an identifier` },
    newTextFor: (o, text, v) => text === cur.name ? v : null,
  }
}

// ---------------------------------------------------------------- context

function planContext(ctx) {
  const { index, cur } = ctx
  const name = cur.name
  const same = index.occurrences.filter(o => o.ns === 'context' && o.name === name)
  const providers = new Set(cur.role === 'provide' ? [cur.component] : cur.providers || [])
  if (!providers.size) return refuse(`can't rename context '${name}': no component rendering ${compName(ctx, cur.component)} provides it`)
  const group = new Set()
  let grew = true
  while (grew) {
    grew = false
    for (const o of same) {
      if (group.has(o)) continue
      const hit = o.role === 'provide' ? providers.has(o.component) : (o.providers || []).some(p => providers.has(p))
      if (!hit) continue
      group.add(o)
      grew = true
      for (const p of o.role === 'provide' ? [o.component] : o.providers || []) providers.add(p)
    }
  }
  for (const id of providers) {
    const c = ctx.comps.get(id)
    if (c?.flags?.contextUnknown) return refuse(`can't rename context '${name}': ${c.name}'s context is built in a way sygnal-check can't read`)
  }
  const orphan = same.find(o => o.role === 'consume' && !(o.providers || []).length)
  if (orphan) return refuse(`can't rename context '${name}': ${compName(ctx, orphan.component)} also reads it (${at(ctx.prep, orphan)}) with no provider sygnal-check can find`)
  const known = new Set(index.occurrences.filter(o => o.ns === 'context').map(o => o.name))
  return {
    kind: 'context', name, group: [...group], comps: [...providers], mentionNames: [name], identifiers: true,
    collide: (n) => known.has(n) ? `context '${n}' already exists` : null,
    validate: (n) => IDENT.test(n) ? { value: n } : { error: `'${n}' isn't a valid context name: use an identifier` },
    newTextFor: (o, text, v) => text === name ? v : null,
  }
}

// ---------------------------------------------------------------- edits, guards, tests

function finish(ctx, plan) {
  const { project, index, prep } = ctx
  // the text at every occurrence must be the name: anything else means the index is out of step
  for (const o of plan.group) {
    if (o.kind === 'uses') continue
    const text = sourceOf(project, o.file).slice(o.start, o.end)
    if (plan.newTextFor(o, text, 'X') == null) return refuse(`can't rename ${plan.name}: the text at ${at(prep, o)} is '${text}', not the name (try again after the next check)`)
  }
  // other mentions of the name in the project's source that the index doesn't account for
  const indexed = new Map()
  for (const o of index.occurrences) {
    if (!indexed.has(o.file)) indexed.set(o.file, [])
    indexed.get(o.file).push(o)
  }
  const covered = (file, s, e) => (indexed.get(file) || []).some(o => o.start < e && s < o.end)
  for (const f of project.files.values()) {
    if (!f?.ast || TEST_FILE.test(f.path)) continue
    if (!plan.mentionNames.some(n => f.source.includes(n))) continue
    for (const m of mentionsIn(f, plan)) {
      if (covered(f.path, m.start, m.end)) continue
      const line = lineOf(f.source, m.start)
      return refuse(`can't rename ${describe(plan)}: '${plan.name}' also appears at ${rel(prep, f.path)}:${line} (${m.what}) where sygnal-check can't tell whether it is the same name; rename by hand${plan.identifiers ? ', or with TypeScript\'s rename where it is typed' : ''}`)
    }
  }
  if (plan.dom) {
    const hit = styleMention(prep, plan)
    if (hit?.external) return refuse(`can't rename ${describe(plan)}: the project uses a stylesheet sygnal-check can't read (${hit.external}, ${rel(prep, hit.file)}:${hit.line}), which might style it`)
    if (hit) return refuse(`can't rename ${describe(plan)}: it is also used in ${rel(prep, hit.file)}:${hit.line}, which sygnal-check doesn't rename (CSS / markup)`)
  }
  if (ctx.newName == null) return plan

  // the new name
  const nn = String(ctx.newName)
  const v = plan.validate(nn)
  if (v.error) return refuse(v.error)
  if (v.value === (plan.bare ?? plan.name)) return refuse(`the new name is the same as the old one`)
  const clash = plan.collide(v.value)
  if (clash) return refuse(`can't rename ${describe(plan)} to '${v.value}': ${clash}`)
  const warnings = v.warning ? [v.warning] : []
  const edits = []
  const seen = new Set()
  for (const o of plan.group) {
    if (o.kind === 'uses') continue
    const k = `${o.file}:${o.start}:${o.end}`
    if (seen.has(k)) continue
    seen.add(k)
    const f = project.files.get(o.file)
    const text = f.source.slice(o.start, o.end)
    let newText = plan.newTextFor(o, text, v.value)
    const adj = adjust(f, o, newText, text)
    if (adj.error) return refuse(adj.error)
    edits.push({ file: o.file, ...pick(o), ...(adj.range || {}), newText: adj.newText, group: o.kind === 'agent' ? 'agent' : 'code' })
  }
  if (edits.some(e => e.group === 'agent')) warnings.push(`renames the agent tool ${plan.name} (the tool name the LLM sees)`)
  edits.sort((a, b) => a.file < b.file ? -1 : a.file > b.file ? 1 : a.start - b.start)
  const tests = testEdits(ctx, plan, v.value, seen)
  return { ...plan, newName: v.value, edits, tests, warnings }
}

const describe = (plan) => plan.kind === 'events' ? `EVENTS '${plan.name}'` : plan.kind === 'class' ? `'.${plan.name}'` : plan.kind === 'id' ? `'#${plan.name}'` : plan.kind === 'action' ? plan.name : `${plan.kind} '${plan.name}'`

function lineOf(text, off) {
  let n = 1
  for (let i = 0; i < off && i < text.length; i++) if (text.charCodeAt(i) === 10) n++
  return n
}

/**
 * The text replacing an occurrence: an identifier key written shorthand (`{ SAVE }`) keeps its
 * value (`NEW: SAVE`); a non-identifier name for an identifier key gets quotes.
 */
function adjust(f, o, newText, oldText) {
  const node = nodeAt(f, o.start, o.end)
  if (node?.type !== 'Identifier') return { newText }
  const parent = f.parents.get(node)
  const isKey = (parent?.type === 'ObjectProperty' || parent?.type === 'ObjectMethod' || parent?.type === 'ClassProperty') && !parent.computed &&
    (parent.key === node || (parent.shorthand && parent.value === node))
  if (isKey && parent.shorthand) return { newText: `${IDENT.test(newText) ? newText : JSON.stringify(newText)}: ${oldText}` }
  if (IDENT.test(newText)) return { newText }
  if (isKey) return { newText: JSON.stringify(newText) }
  return { error: `'${newText}' can't replace the identifier at ${path.basename(f.path)}:${o.line}: use an identifier` }
}

function nodeAt(f, start, end) {
  let found = null
  walk(f.ast.program, (n) => {
    if (n.start > start || n.end < end) return false
    // (a shorthand property has the range of its key: the key is the one wanted)
    if (n.start === start && n.end === end && (!found || (found.type !== 'Identifier' && n.type === 'Identifier'))) found = n
    return true
  })
  return found
}

/**
 * Mentions of the plan's name in a file: string literals (and template parts), property keys and
 * member names. → [{ start, end, what }]
 */
function mentionsIn(f, plan, { test = false } = {}) {
  const out = []
  const names = plan.mentionNames
  const words = test && plan.kind !== 'class' && plan.kind !== 'id' ? names.filter(n => SCREAMING.test(n) && n.includes('_')) : []
  const lit = (node, raw, base, parent) => {
    if (raw == null) return
    const value = raw
    for (const n of names) {
      if (plan.dom) {
        for (const m of domMentions(value, n, plan.dom, attrOf(parent, f), node)) out.push({ start: base + m, end: base + m + n.length, what: 'a string' })
        continue
      }
      const t = value.trim()
      if (t === n) { const i = value.indexOf(n); out.push({ start: base + i, end: base + i + n.length, what: 'a string' }); continue }
      const sh = /^\s*([^|\s]+)\s*\|/.exec(value)
      if (sh && sh[1] === n) { const i = value.indexOf(n); out.push({ start: base + i, end: base + i + n.length, what: 'a string' }); continue }
      if (words.includes(n)) {
        const re = new RegExp(`(?<![\\w.])${esc(n)}(?![\\w])`, 'g')
        let m
        while ((m = re.exec(value))) out.push({ start: base + m.index, end: base + m.index + n.length, what: 'a string', word: true })
      }
    }
  }
  walk(f.ast.program, (node, parent) => {
    switch (node.type) {
      case 'ImportDeclaration': case 'ExportAllDeclaration': return false
      case 'StringLiteral': {
        if (parent?.type === 'ExportNamedDeclaration' && parent.source === node) return false
        const raw = node.extra?.raw
        if (raw != null && !raw.includes('\\')) lit(node, raw.slice(1, -1), node.start + 1, parent)
        else if (names.some(n => node.value.includes(n))) out.push({ start: node.start, end: node.end, what: 'a string with escapes' })
        return false
      }
      case 'TemplateElement': {
        const raw = node.value.raw
        if (raw != null && !raw.includes('\\')) lit(node, raw, node.start, f.parents.get(parent))
        return false
      }
      case 'JSXText': return false
      case 'Identifier': {
        if (plan.dom) {
          // classes({ active: x }) keys
          if (parent?.type === 'ObjectProperty' && parent.key === node && !parent.computed && names.includes(node.name)) {
            const call = f.parents.get(f.parents.get(parent))
            if (call?.type === 'CallExpression' && call.callee?.type === 'Identifier' && CLASS_HELPERS.has(call.callee.name)) out.push({ start: node.start, end: node.end, what: 'a classes() key' })
          }
          return false
        }
        if (!names.includes(node.name)) return false
        const member = (parent?.type === 'MemberExpression' || parent?.type === 'OptionalMemberExpression') && parent.property === node && !parent.computed
        const key = (parent?.type === 'ObjectProperty' || parent?.type === 'ObjectMethod' || parent?.type === 'ClassProperty' || parent?.type === 'ClassMethod') && parent.key === node && !parent.computed
        if (member) out.push({ start: node.start, end: node.end, what: `.${node.name}` })
        else if (key) out.push({ start: node.start, end: node.end, what: `a property key` })
        return false
      }
    }
    return true
  })
  return out
}

/** The JSX attribute name or object key a literal is the value of (className, id, for ...), or null. */
function attrOf(parent, f) {
  if (!parent) return null
  if (parent.type === 'JSXAttribute') return parent.name?.name ?? null
  if (parent.type === 'JSXExpressionContainer') { const a = f.parents.get(parent); return a?.type === 'JSXAttribute' ? a.name?.name ?? null : null }
  if (parent.type === 'ObjectProperty' && parent.key?.type === 'Identifier') return parent.key.name
  if (parent.type === 'CallExpression' && parent.callee?.type === 'Identifier' && CLASS_HELPERS.has(parent.callee.name)) return 'className'
  return null
}

/** Offsets of `name` in a string's text as a class / id: `.name` / `#name`, the whole text, or a word of a class / id attribute. */
function domMentions(text, name, kind, attr) {
  const out = new Set()
  const mark = kind === 'id' ? '#' : '\\.'
  const re = new RegExp(`${mark}${esc(name)}(?![\\w-])`, 'g')
  let m
  while ((m = re.exec(text))) out.add(m.index + 1)
  if (text.trim() === name) out.add(text.indexOf(name))
  const attrs = kind === 'id' ? ID_ATTRS : CLASS_ATTRS
  if (attr && (attrs.has(attr) || (kind === 'id' && /^aria-/.test(attr)))) {
    const w = new RegExp(`(?<![\\w-])${esc(name)}(?![\\w-])`, 'g')
    while ((m = w.exec(text))) out.add(m.index)
  }
  return [...out]
}

/** Files of the folder whose name matches `re` (the walk skips node_modules, dist ...). */
function filesUnder(dir, re, out = [], depth = 0) {
  if (depth > 12) return out
  let entries
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return out }
  for (const e of entries) {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) { if (!e.name.startsWith('.') && !IGNORED_DIRS.has(e.name)) filesUnder(full, re, out, depth + 1) }
    else if (e.isFile() && re.test(e.name)) out.push(full)
  }
  return out
}

const readText = (prep, abs) => {
  if (prep.srcs?.has(abs)) return prep.srcs.get(abs)
  try { return fs.readFileSync(abs, 'utf8') } catch { return null }
}

function styleMention(prep, plan) {
  if (!prep.folder) return null
  // stylesheets sygnal-check can't read: imported from a package, or linked from elsewhere
  for (const f of prep.project.files.values()) {
    for (const s of f?.ast?.program.body || []) {
      const spec = s.type === 'ImportDeclaration' ? s.source.value : null
      if (spec && /\.(css|scss|sass|less|styl)(\?.*)?$/.test(spec) && !spec.startsWith('.') && !spec.startsWith('/')) return { file: f.path, line: s.loc.start.line, external: spec }
    }
  }
  const n = plan.name
  const re = plan.dom === 'id' ? new RegExp(`#${esc(n)}(?![\\w-])`) : new RegExp(`\\.${esc(n)}(?![\\w-])`)
  const word = new RegExp(`(?<![\\w-])${esc(n)}(?![\\w-])`)
  for (const file of filesUnder(prep.folder, STYLE_FILE)) {
    const text = readText(prep, file)
    const markup = /\.(html?|vue|svelte|astro)$/.test(file)
    if (!text || (!text.includes(n) && !(markup && /stylesheet/i.test(text)))) continue
    const lines = text.split('\n')
    if (markup) {
      for (let i = 0; i < lines.length; i++) {
        const l = /<link\b[^>]*rel=["']?stylesheet[^>]*>/i.exec(lines[i])
        const href = l && /href=["']?([^"' >]+)/i.exec(l[0])?.[1]
        if (href && (/^[a-z]+:|^\/\//i.test(href))) return { file, line: i + 1, external: href }
      }
    }
    for (let i = 0; i < lines.length; i++) if (re.test(lines[i]) || (markup && word.test(lines[i]))) return { file, line: i + 1 }
  }
  return null
}

/**
 * Test files under the folder (and the project's own, with includeTests): their mentions of the
 * name, as edits for confirmation. For a component's names (actions, state, context) only the
 * test files that import one of its files.
 */
function testEdits(ctx, plan, value, seen) {
  const { prep, project, index } = ctx
  if (!prep.folder) return []
  const files = new Set(filesUnder(prep.folder, TEST_FILE))
  for (const f of expandInputs(prep.options?.paths || [], { cwd: prep.folder, includeTests: true, sources: prep.srcs }).files) if (TEST_FILE.test(f)) files.add(f)
  for (const abs of prep.srcs?.keys() || []) if (TEST_FILE.test(abs) && abs.startsWith(prep.folder)) files.add(abs)
  const compFiles = plan.comps ? new Set(plan.comps.map(id => ctx.comps.get(id)?.file).filter(Boolean)) : null
  if (compFiles) for (const o of plan.group) compFiles.add(o.file)
  const out = []
  for (const abs of [...files].sort()) {
    const text = project.files.get(abs)?.source ?? readText(prep, abs)
    if (!text || !plan.mentionNames.some(n => text.includes(n))) continue
    let f = project.files.get(abs)
    if (!f?.ast) {
      let ast
      try { ast = parseSource(text, abs) } catch { continue }
      if (ast.errors?.length) continue
      const parents = new WeakMap()
      walk(ast.program, (n, p) => { if (p) parents.set(n, p) })
      f = { path: abs, source: text, ast, parents }
    }
    if (compFiles && !importsAny(f, compFiles, prep)) continue
    for (const m of mentionsIn(f, plan, { test: true })) {
      const k = `${abs}:${m.start}:${m.end}`
      if (seen.has(k)) continue
      seen.add(k)
      if (index.occurrences.some(o => o.file === abs && o.start < m.end && m.start < o.end)) continue
      const oldText = text.slice(m.start, m.end)
      const target = plan.newTextFor(null, oldText, value) ?? value
      const adj = adjust(f, { start: m.start, end: m.end, line: lineOf(text, m.start) }, target, oldText)
      if (adj.error) continue
      out.push({ file: abs, ...spanRange(text, m.start, m.end), newText: adj.newText, group: 'test' })
    }
  }
  return out
}

function importsAny(f, targets, prep) {
  const isFile = (p) => prep.srcs?.has(p) || fs.existsSync(p)
  for (const s of f.ast.program.body) {
    if (s.type !== 'ImportDeclaration' && !(s.type === 'ExportNamedDeclaration' && s.source) && s.type !== 'ExportAllDeclaration') continue
    const r = resolveImport(f.path, s.source.value, { isFile })
    if (r && targets.has(r)) return true
  }
  return false
}

function spanRange(text, start, end) {
  const lc = (off) => {
    let line = 1, ls = 0
    for (let i = 0; i < off; i++) if (text.charCodeAt(i) === 10) { line++; ls = i + 1 }
    return [line, off - ls + 1]
  }
  const [line, column] = lc(start)
  const [endLine, endColumn] = lc(end)
  return { start, end, line, column, endLine, endColumn }
}
