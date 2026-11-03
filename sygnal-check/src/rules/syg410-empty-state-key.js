/**
 * SYG410, statically: a child component's literal `state=""` (or a path with an empty segment:
 * "x.", ".x", "a..b") names an empty key, so the child reads `state[""]`, gets no state and isn't
 * rendered, silently. The dev checks report the same at run time (with the other SYG410 cases:
 * a `state` prop that is neither a key nor a lens). --fix for `state=""`: remove the attribute,
 * so the child shares the parent's state (what an empty key usually means).
 */
import { jsxAttr } from '../ast.js'

const emptySegment = (p) => p.replace(/\[(\d+)\]/g, '.$1').split('.').includes('')

export default {
  id: 'empty-state-key',
  codes: ['SYG410'],
  description: "A child's state prop names an empty key",
  run(project, report) {
    const seen = new Set()
    const visit = (comp, sink) => {
      for (const u of sink?.children || []) {
        if (u.injected) visit(comp, u.injected)
        if (u.kind !== 'tag' || typeof u.state != 'string' || seen.has(u.node) || !emptySegment(u.state)) continue
        seen.add(u.node)
        const file = u.file || comp.file
        const attr = jsxAttr(u.node, 'state')
        const empty = u.state === ''
        let start = attr.start
        while (start > 0 && /\s/.test(file.source[start - 1])) start--
        report({
          code: 'SYG410',
          component: comp.name,
          file,
          node: attr,
          message: `<${u.name} state="${u.state}"> ${empty ? 'names an empty key' : 'has an empty path segment'}, so ${u.name} gets no state and doesn't render`,
          fix: empty ? `leave state out to share the parent's state (<${u.name} />), or name a key: state="user"`
            : 'name a key in every segment of the path: state="user.name"',
          data: { designator: u.state },
          fixes: empty ? [{ title: 'Remove state="" (share the parent\'s state)', kind: 'quickfix', preferred: true, fixAll: true,
            edits: [{ file: file.path, start, end: attr.end, text: '' }] }] : undefined,
        })
      }
    }
    for (const comp of project.components) {
      if (!comp.view) continue
      visit(comp, project.viewOf({ file: comp.file, node: comp.view }))
    }
  },
}
