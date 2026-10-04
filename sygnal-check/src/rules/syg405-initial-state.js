/**
 * SYG405, statically (PLAN-4 4-G2; REPORT-v4: 4 of 5 Haiku trials on task 28): a component with an
 * `initialState` and no `isolatedState = true` that another component renders. The runtime check
 * (src/component.ts) fires for every sub-component, with or without a `state` prop:
 *
 *   - rendered by tag (`<Stopwatch state="stopwatch" />`, `<Stopwatch />`): error. The runtime
 *     throws when it creates the child; the parent renders its error fallback instead;
 *   - a Collection item or Switchable target: warn. The runtime warns, and the child's
 *     initialState replaces what the parent passes in.
 *
 * Reported once, at the `initialState` assignment. Silent when `isolatedState` is set to anything
 * but a literal `false` (true, or a value the checker can't read), when the component has no
 * view function, and when no view the checker can follow renders it (a root, or a component
 * only rendered from files that aren't scanned or loaded).
 */
import { loc } from '../ast.js'
import { renderedUsages, stateAttr } from '../model/usages.js'

function isolated(comp) {
  const v = comp.staticProps.isolatedState
  if (!v) return false
  return !(v.type === 'BooleanLiteral' && v.value === false)
}

export default {
  id: 'initial-state-sub-component',
  codes: ['SYG405'],
  description: 'Sub-component has initialState without isolatedState',
  run(project, report) {
    const targets = project.components.filter(c => c.view && c.staticProps.initialState && !isolated(c))
    if (!targets.length) return
    const usages = renderedUsages(project)
    for (const comp of targets) {
      const uses = usages.filter(u => u.usage.ref?.node === comp.view)
      if (!uses.length) continue
      const tag = uses.find(u => u.usage.kind === 'tag')
      const { owner, usage } = tag || uses[0]
      const X = comp.name
      const P = owner.name
      const at = `${project.relPath(usage.file.path)}:${loc(usage.node).line}`
      const base = 'Sub-component initialState replaces the state its parent passes in'
      let message, fix
      if (tag) {
        const st = stateAttr(usage)
        const shown = st ? `<${X} ${st.text}>` : `<${X}>`
        message = `${base}: ${P} renders ${shown} (${at}), so ${X}.initialState would overwrite ` +
          (st ? 'the slice it is given' : `${P}'s state, which it shares`) +
          `. The runtime throws when it creates ${X}, and ${P} renders its error fallback instead`
        const where = st?.field ? ` (under '${st.field}')` : st ? ' (in the slice the state lens reads)' : ''
        fix = `Remove ${X}.initialState and put its start values in ${P}'s initialState${where}, ` +
          `or set ${X}.isolatedState = true if ${X} should keep state of its own`
      } else {
        const what = usage.kind === 'collection' ? 'a Collection item' : 'a Switchable target'
        message = `${base}: ${P} renders ${X} as ${what} (${at}), so ${X}.initialState replaces the state ${P} passes in`
        fix = usage.kind === 'collection'
          ? `Remove ${X}.initialState and give each item its start values in the array ${P} passes in, or set ${X}.isolatedState = true`
          : `Remove ${X}.initialState and put its start values in ${P}'s initialState, or set ${X}.isolatedState = true`
      }
      report({
        code: 'SYG405',
        severity: tag ? 'error' : 'warn',
        component: X,
        file: comp.file,
        node: comp.staticPropNodes.initialState || comp.staticProps.initialState,
        message,
        fix,
        data: { parent: P, kind: usage.kind, at },
      })
    }
  },
}
