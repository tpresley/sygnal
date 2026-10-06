/**
 * SYG612, statically (PLAN-4.6 R5, 05-migration-guide §4): forms Sygnal 6.0 removed (D162-D164)
 * that no other rule finds. Always on (not only under --strict): the forms no longer work. The
 * runtime reports the same code in development (the dev entry, D173).
 *
 *   X.components / X.peers / X.hmrActions / X.storeCalculatedInState /
 *   X.DOMSourceName / X.stateSourceName = …        on a component (G-336: X has component
 *                                                   statics, or is bound to a function; never a
 *                                                   parameter or a plain object like `draft.peers`)
 *   X.label = …                                     on a component (a name; use componentName)
 *   import { component, collection, switchable } from 'sygnal'   (the removed factories)
 *   <Collection of="Name">                          (a name; pass the component) - G-336: only
 *   <Collection idfield="key">                      (items are keyed by `id`)   sygnal's Collection
 *   <Collection className="x" style={…} …>          (4-H, D229: the wrapper element is gone; also
 *                                                   class, attrs, data/data-*, on/on-*, hook, ref)
 *
 * Positional views ('positional-views'), 'ACTION | SINK' keys ('pipe-keys') and
 * CHILD.select('Name') ('child-select-name') are SYG501 / SYG504 / SYG506 (--strict, with --fix).
 *
 * --fix: removes a `X.storeCalculatedInState = …` statement (calculated fields are always
 * stored), and a `X.DOMSourceName = 'DOM'` / `X.stateSourceName = 'STATE'` one (the default).
 * G-337: only a statement in a statement list (module body, block, switch case); one that is
 * the body of an `if` / loop / label is reported without a fix (deleting it would make the next
 * statement the body).
 */
import { walk, unwrap, memberName, stringValue, isFunction } from '../ast.js'
import { findBinding } from '../scope.js'

const GUIDE = 'https://sygnal.js.org/guide/migrating-to-6'

/** static name → [anchor, what it was, how to write it now] */
const STATICS = {
  components: ['components', 'the .components registry', 'import each component and use it as a JSX tag (<Badge />); remove .components'],
  peers: ['peers', '.peers', 'render the peer as a sibling in the parent view (it shares state through the state prop and reports through PARENT / CHILD.select)'],
  hmrActions: ['hmractions', 'hmrActions', "remove it: sygnal/vite keeps the state across a hot update; an action to run after the swap goes in the model's BOOTSTRAP"],
  storeCalculatedInState: ['storecalculatedinstate', 'storeCalculatedInState', 'remove it: calculated fields are always part of the state'],
  DOMSourceName: ['source-names', 'DOMSourceName', 'remove it: the sources are always DOM and STATE'],
  stateSourceName: ['source-names', 'stateSourceName', 'remove it: the sources are always DOM and STATE'],
}
const DEFAULT_SOURCE = { DOMSourceName: 'DOM', stateSourceName: 'STATE' }
const FACTORIES = new Set(['component', 'collection', 'switchable'])

/** 4-H (D229): the <Collection> attributes that went only to its removed wrapper element */
const WRAPPER = /^(className|style|class|attrs|data|on|hook|ref|(style|class|attrs|data|on|hook)-.+)$/

const STATEMENT_LISTS = new Set(['Program', 'BlockStatement', 'StaticBlock', 'SwitchCase', 'TSModuleBlock'])

function removal(file, stmt, parent) {
  if (!parent || !STATEMENT_LISTS.has(parent.type)) return undefined
  let end = stmt.end
  if (file.source[end] === '\n') end++
  return [{ file: file.path, start: stmt.start, end, text: '' }]
}

export default {
  id: 'removed-forms',
  codes: ['SYG612'],
  description: 'A form Sygnal 6.0 removed',
  run(project, report) {
    for (const p of project.scanned) {
      const file = project.files.get(p)
      if (!file?.ast) continue
      const componentNames = new Set((file.components || []).map(c => c.name))
      // G-336: X in `X.peers = …` is a component when it has component statics in this file, or
      // is bound to a function (an old component with a view and only removed statics)
      const isComponent = (ident) => {
        if (componentNames.has(ident.name)) return true
        const b = findBinding(file, ident.name, ident)
        return !!b && (b.kind === 'function' || (b.kind === 'var' && isFunction(unwrap(b.init))))
      }
      // G-336: the local names sygnal's Collection is imported under
      const collectionNames = new Set()
      for (const st of file.ast.program.body) {
        if (st.type !== 'ImportDeclaration' || st.source?.value !== 'sygnal' || st.importKind === 'type') continue
        for (const s of st.specifiers || []) {
          if (s.type === 'ImportSpecifier' && (s.imported.name ?? s.imported.value) === 'Collection') collectionNames.add(s.local.name)
        }
      }
      const say = (node, component, anchor, what, fix, data = {}, edits) => report({
        code: 'SYG612',
        component,
        file,
        node,
        message: `${what}, which Sygnal 6.0 removed`,
        fix: `${fix[0].toUpperCase()}${fix.slice(1)}. See ${GUIDE}#${anchor}`,
        data: { form: anchor, ...data },
        edits,
      })
      walk(file.ast.program, (n, parent) => {
        // X.static = …
        if (n.type === 'ExpressionStatement') {
          const e = unwrap(n.expression)
          if (e.type === 'AssignmentExpression' && e.operator === '=' && e.left.type === 'MemberExpression') {
            const obj = unwrap(e.left.object)
            const prop = memberName(e.left)
            if (obj.type === 'Identifier' && Object.hasOwn(STATICS, prop) && isComponent(obj)) {
              const [anchor, what, fix] = STATICS[prop]
              const value = stringValue(e.right)
              const fixable = prop === 'storeCalculatedInState' || (prop in DEFAULT_SOURCE && value === DEFAULT_SOURCE[prop])
              say(e.left, obj.name, anchor, `${obj.name} sets ${what}`, fix, { static: prop }, fixable ? removal(file, n, parent) : undefined)
            } else if (obj.type === 'Identifier' && prop === 'label' && componentNames.has(obj.name)) {
              say(e.left, obj.name, 'leftovers', `${obj.name}.label names the component`, `use the function's name, or ${obj.name}.componentName = …`, { static: 'label' })
            }
          }
          return true
        }
        // import { component } from 'sygnal'
        if (n.type === 'ImportDeclaration') {
          if (n.source?.value !== 'sygnal') return false
          for (const s of n.specifiers || []) {
            const name = s.type === 'ImportSpecifier' ? (s.imported.name ?? s.imported.value) : null
            if (name && FACTORIES.has(name)) {
              say(s, 'module', 'component-factory', `'${name}' is imported from 'sygnal' (the ${name}() factory)`,
                name === 'component'
                  ? 'write a function component with statics (C.model, C.intent, C.initialState), or use defineComponent({ ... })'
                  : `render <${name[0].toUpperCase() + name.slice(1)}> in a view instead`,
                { import: name })
            }
          }
          return false
        }
        // <Collection of="Name" idfield="key">
        if (n.type === 'JSXOpeningElement' && n.name?.type === 'JSXIdentifier' && collectionNames.has(n.name.name)) {
          for (const a of n.attributes || []) {
            if (a.type !== 'JSXAttribute') continue
            const an = a.name?.name
            if (an === 'of' && a.value?.type === 'StringLiteral') {
              say(a, 'module', 'collection-of-name', `<Collection of="${a.value.value}"> names the item component`, `pass the component itself: <Collection of={${a.value.value}} … />`, { of: a.value.value })
            } else if (an === 'idfield') {
              say(a, 'module', 'leftovers', '<Collection idfield> keys the items by another field', 'give the items an id field (or map them to one)', { attribute: 'idfield' })
            } else if (typeof an === 'string' && WRAPPER.test(an)) {
              say(a, 'module', 'collection-wrapper', `<Collection ${an}> sets an attribute of the Collection's wrapper element (Collection renders its items directly into its parent now)`,
                'put it on your own wrapping element: <ul className="x"><Collection of={Item} from="items" /></ul>', { attribute: an })
            }
          }
        }
        return true
      })
    }
  },
}
