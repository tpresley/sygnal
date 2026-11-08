/**
 * SYG108: an intent selector that is not valid CSS (selectors.js selectorProblem()).
 *
 * The DOM driver matches selectors with Element.matches(), so an invalid one throws a SyntaxError
 * on every event and takes the component's other listeners down with it. The usual cause is a
 * utility class as the hook: DOM.click('.hover:bg-red-500'). SYG110 skips these selectors: the
 * class it would read (`.hover`) is not what was meant.
 */
import { selectorProblem } from '../selectors.js'

const via = (sel) => sel.behavior ? `behavior '${sel.behavior}' (option ${sel.option}): ` : ''

/** The utility text of a selector that is one class: '.hover:bg-red-500' → 'hover:bg-red-500' */
const oneClass = (selector) => /^\.[^\s,>+~]+$/.test(selector.trim()) ? selector.trim().slice(1) : null

function hookFix(sel) {
  const utility = oneClass(sel.selector)
  const className = utility ? `className="save ${utility}"` : 'className="save …"'
  return `give the element a separate hook class and select that: ${className} with DOM.${sel.method}('.save'), or use a control`
}

export default {
  id: 'invalid-selector',
  codes: ['SYG108'],
  description: 'Intent selector is not valid CSS',
  run(project, report) {
    for (const comp of project.components) {
      for (const sel of [...(comp.intent?.selectors || []), ...(comp.behaviorSelectors || [])]) {
        if (sel.dynamic || sel.global || !sel.selector) continue
        const problem = selectorProblem(sel.selector)
        if (!problem) continue
        report({
          code: 'SYG108',
          component: comp.name,
          file: sel.file || comp.intent.file,
          node: sel.node,
          message: `${via(sel)}selector '${sel.selector}' is not valid CSS: ${problem}, so matching it throws a SyntaxError on every event and stops the component's other DOM listeners`,
          fix: hookFix(sel),
          data: { selector: sel.selector, problem },
        })
      }
    }
  },
}
