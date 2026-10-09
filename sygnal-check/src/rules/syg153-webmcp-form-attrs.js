/**
 * SYG153 (PLAN-6 K-1, D269, G-598): a WebMCP declarative-form attribute written as a plain JSX
 * attribute (`<form toolname="sign_up">`, `toolparamdescription` on a field). The pragma turns an
 * unknown JSX attribute into a DOM property, not an HTML attribute, so the browser's agent never
 * sees the form as a tool. They are written `attrs-toolname="sign_up"` (or inside
 * `attrs={{ ... }}`), as the `form` behavior's `tool` option (A-3) will emit them.
 */
import { walk, jsxName, loc } from '../ast.js'

const FORM_ATTRS = new Set(['toolname', 'tooldescription', 'toolautosubmit'])
const FIELD_ATTRS = new Set(['toolparamdescription'])

export default {
  id: 'webmcp-form-attrs',
  codes: ['SYG153'],
  description: 'WebMCP form attribute written as a DOM property',
  run(project, report) {
    for (const p of project.scanned) {
      const file = project.files.get(p)
      if (!file) continue
      walk(file.ast.program, (n) => {
        if (n.type !== 'JSXOpeningElement') return true
        const tag = jsxName(n.name)
        if (!tag || !/^[a-z]/.test(tag) || tag.includes('-')) return true
        for (const a of n.attributes) {
          if (a.type !== 'JSXAttribute') continue
          const name = jsxName(a.name)
          if (!FORM_ATTRS.has(name) && !FIELD_ATTRS.has(name)) continue
          if (FORM_ATTRS.has(name) && tag !== 'form') continue
          report({
            code: 'SYG153',
            component: project.componentAt(file, n)?.name,
            file, node: a,
            message: `<${tag} ${name}=...> (line ${loc(a).line}) sets a DOM property, not the ${name} attribute WebMCP reads, so the browser's agent doesn't see ${tag === 'form' ? 'this form as a tool' : 'this parameter description'}`,
            fix: `write the attribute: attrs-${name}="..." (or attrs={{ ${name}: '...' }})`,
            data: { attribute: name, element: tag },
          })
        }
        return true
      })
    }
  },
}
