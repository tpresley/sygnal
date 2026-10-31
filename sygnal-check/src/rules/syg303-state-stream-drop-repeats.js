/**
 * SYG303 (info; warn under --strict): an intent stream built on `STATE.stream` and composed with
 * `dropRepeats()`, the hand-written form of "react when this part of the state changes":
 *
 *   SAVE: STATE.stream.map(s => s.text).compose(dropRepeats()).compose(debounce(1000))
 *
 * The canonical form is `STATE.watch(fn)` (a Collection item watches its own state, values are
 * compared structurally, `{ immediate: true }` emits the current one first), which needs no
 * xstream extra at all (Temper feedback, 2026-10: the hand-written form came with a default
 * import from 'xstream/extra/dropRepeats', SYG302, and failed at run time). No --fix: STATE.stream
 * emits the current state at once and dropRepeats compares with ===, so a rewrite can change when
 * the action fires.
 *
 * `dropRepeats` counts when it is imported from 'sygnal' or 'xstream/extra/dropRepeats'. Under
 * --strict the strict copy (`strict: true`, warn) replaces this one (`notStrict`).
 */
import { walk, unwrap, memberName } from '../ast.js'
import { findBinding } from '../scope.js'
import { sourceAliases, isSourceRef } from '../model/intent.js'

const DROP_REPEATS = /^xstream\/extra\/dropRepeats(?:\.js)?$/

/** is `call` a call of dropRepeats imported from 'sygnal' or xstream's extra? */
function isDropRepeats(file, call) {
  call = unwrap(call)
  if (call?.type !== 'CallExpression') return false
  const callee = unwrap(call.callee)
  if (callee?.type !== 'Identifier') return false
  const b = findBinding(file, callee.name, callee)
  return b?.kind === 'import' &&
    ((b.source === 'sygnal' && b.imported === 'dropRepeats') || (DROP_REPEATS.test(b.source) && b.imported === 'default'))
}

/** does the operator chain under `node` start at STATE.stream? */
function fromStateStream(node, sa) {
  for (let n = unwrap(node), i = 0; n && i < 32; i++) {
    if (n.type === 'CallExpression') n = unwrap(n.callee)
    else if (n.type === 'MemberExpression') {
      if (memberName(n) === 'stream' && isSourceRef(n.object, 'STATE', sa)) return true
      n = unwrap(n.object)
    } else return false
  }
  return false
}

function rule(strict) {
  return {
    id: strict ? 'strict-state-stream-drop-repeats' : 'state-stream-drop-repeats',
    codes: ['SYG303'],
    description: 'STATE.stream with dropRepeats() in an intent',
    perFile: true,
    ...(strict ? { strict: true } : { notStrict: true }),
    run(project, report) {
      for (const comp of project.components) {
        const intent = comp.intent
        if (!intent?.fn || !intent.file?.ast) continue
        const sa = sourceAliases(intent.fn)
        walk(intent.fn.body, (n) => {
          if (n.type !== 'CallExpression') return true
          const callee = unwrap(n.callee)
          if (callee?.type !== 'MemberExpression' || memberName(callee) !== 'compose') return true
          if (!isDropRepeats(intent.file, n.arguments[0]) || !fromStateStream(callee.object, sa)) return true
          report({
            code: 'SYG303',
            severity: strict ? 'warn' : 'info',
            component: comp.name,
            file: intent.file,
            node: n,
            message: `${comp.name}'s intent watches the state by hand: STATE.stream … .compose(dropRepeats())`,
            fix: "Use STATE.watch(fn): `CHANGED: STATE.watch(state => state.tab)` emits the selected value each time it changes (compared structurally; `{ immediate: true }` also emits the current one), with no xstream extra to import",
          })
          return false
        })
      }
    },
  }
}

export default rule(false)
export const strictStateStreamDropRepeats = rule(true)
