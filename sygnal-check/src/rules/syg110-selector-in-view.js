/**
 * SYG110: a class/id selector used in intent (DOM.select('.x'), DOM.click('.x'),
 * …) that the component's own view never renders.
 *
 * SYG104 (static): the class/id is rendered, but only inside a CHILD
 * component (or in JSX passed into one). Child components are isolated, so
 * the parent's DOM source never sees those events.
 *
 * Severity:
 *   warn  the name appears nowhere the component can see
 *   info  a dynamic className/id in the view might produce it, or the
 *         selector itself is dynamic
 */
import { selectorRequirements } from '../selectors.js'

const MAX_CHILD_DEPTH = 6

function viewHas(sink, kind, name) {
  return (kind === 'class' ? sink.classes : sink.ids).names.has(name)
}

function patternMatch(sink, kind, name) {
  const set = kind === 'class' ? sink.classes : sink.ids
  return set.patterns.find(p => p.re.test(name)) || null
}

/**
 * Breadth-first search through child components for an exact class/id.
 * @returns {{ child: string, via: string[] } | null}
 */
function findInChildren(project, sink, kind, name) {
  const visited = new Set()
  let frontier = sink.children.map(c => ({ usage: c, path: [c.name] }))
  for (let depth = 0; depth < MAX_CHILD_DEPTH && frontier.length; depth++) {
    const next = []
    for (const { usage, path } of frontier) {
      if (viewHas(usage.injected, kind, name)) return { child: path[0], via: path }
      const childSink = usage.ref ? project.viewOf(usage.ref) : null
      if (childSink && !visited.has(childSink)) {
        visited.add(childSink)
        if (viewHas(childSink, kind, name)) return { child: path[0], via: path }
        for (const c of childSink.children) next.push({ usage: c, path: [...path, c.name] })
      }
      for (const c of usage.injected.children) next.push({ usage: c, path: [...path, c.name] })
    }
    frontier = next
  }
  return null
}

const show = (kind, name) => (kind === 'class' ? '.' : '#') + name

export default {
  id: 'selector-in-view',
  codes: ['SYG110', 'SYG104'],
  description: 'Intent selector not present in the component view / only present in a child component',
  run(project, report) {
    for (const comp of project.components) {
      const intent = comp.intent
      const view = comp.viewInfo
      if (!intent || !view || intent.selectors.length === 0) continue
      const injected = project.injectedInto(comp.view)
      for (const sel of intent.selectors) {
        if (sel.global) continue
        if (sel.dynamic) {
          report({
            code: 'SYG110',
            severity: 'info',
            component: comp.name,
            file: intent.file,
            node: sel.node,
            message: `DOM.${sel.method}() selector is not a static string, so it was not checked against the view`,
            fix: 'use a string literal selector (or a module-level const) so it can be checked',
          })
          continue
        }
        for (const { kind, name } of selectorRequirements(sel.selector)) {
          if (viewHas(view, kind, name)) continue
          // JSX a parent passes in as children/slots renders in this component's scope
          if (injected.some(sink => viewHas(sink, kind, name))) continue
          const inChild = findInChildren(project, view, kind, name)
          if (inChild) {
            const child = inChild.child
            const where = inChild.via.length > 1 ? ` (rendered by ${inChild.via.join(' > ')})` : ''
            report({
              code: 'SYG104',
              component: comp.name,
              file: intent.file,
              node: sel.node,
              message: `selector '${sel.selector}' targets ${show(kind, name)}, which is only rendered inside child component <${child}>${where}; parents can't see DOM events inside child components`,
              fix: `handle it in <${child}> and send it up via PARENT or EVENTS`,
              data: { selector: sel.selector, [kind]: name, child, path: inChild.via },
            })
            continue
          }
          const pattern = patternMatch(view, kind, name) || injected.map(sink => patternMatch(sink, kind, name)).find(Boolean)
          if (pattern) {
            report({
              code: 'SYG110',
              severity: 'info',
              component: comp.name,
              file: intent.file,
              node: sel.node,
              message: `selector '${sel.selector}' targets ${show(kind, name)}, which is not a static ${kind === 'class' ? 'className' : 'id'} in the view; ` +
                (pattern.source === '*' ? 'a dynamic value might produce it' : `it might come from the dynamic value '${pattern.source}'`),
              fix: `check that the view really renders ${show(kind, name)}, or add it as a static ${kind === 'class' ? 'class' : 'id'}`,
              data: { selector: sel.selector, [kind]: name, pattern: pattern.source },
            })
            continue
          }
          report({
            code: 'SYG110',
            component: comp.name,
            file: intent.file,
            node: sel.node,
            message: `selector '${sel.selector}' targets ${show(kind, name)}, but ${comp.name}'s view never renders ${kind === 'class' ? 'that class' : 'that id'}, so this action never fires`,
            fix: closestHint(view, kind, name) || `add ${kind === 'class' ? 'className' : 'id'}="${name}" to the element in the view, or fix the selector`,
            data: { selector: sel.selector, [kind]: name },
          })
        }
      }
    }
  },
}

function editDistance(a, b) {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)])
  for (let j = 1; j <= b.length; j++) dp[0][j] = j
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    }
  }
  return dp[a.length][b.length]
}

function commonPrefix(a, b) {
  let i = 0
  while (i < a.length && i < b.length && a[i] === b[i]) i++
  return i
}

/** Suggest the closest class/id the view does render (typos, -btn vs -button). */
function closestHint(view, kind, name) {
  let best = null
  let bestScore = Infinity
  for (const n of (kind === 'class' ? view.classes : view.ids).names) {
    let score = editDistance(n, name)
    // 'add-todo-btn' vs 'add-todo-button': long shared prefix, short tails
    const p = commonPrefix(n, name)
    if (p >= 4 && Math.max(n.length, name.length) - p <= 6) score = Math.min(score, 2)
    if (score < bestScore) { bestScore = score; best = n }
  }
  if (best && bestScore <= Math.max(2, Math.floor(name.length / 3))) {
    const sigil = kind === 'class' ? '.' : '#'
    return `did you mean '${sigil}${best}'? The view renders ${kind === 'class' ? 'className' : 'id'}="${best}"`
  }
  return null
}
