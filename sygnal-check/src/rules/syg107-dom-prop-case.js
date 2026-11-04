/**
 * SYG107 (7.2, Sift preview.5 #2/#3): a DOM property name in the wrong case on an HTML element.
 *
 * The pragma sets a JSX name on an HTML element as the DOM property of that name, as written, so
 * React's `autoComplete` / `srcSet` or the attribute's lowercase `inputmode` / `maxlength` set an
 * unused JavaScript property: nothing is rendered. Reported for a JSX attribute on an intrinsic
 * HTML element (not inside `<svg>`, not a custom element) whose name matches one of DOM_PROPS
 * in a different case. Names the pragma writes as attributes (ATTRS, BOOLISH) are skipped.
 *
 * DOM_PROPS is the dev entry's table (src/extra/diagnostics/checks/domProps.ts); the root test
 * test/syg107-dom-prop-case.test.js keeps the two equal.
 *
 * --fix: renames the attribute.
 */
import { walk, jsxName } from '../ast.js'
import { componentName } from './a11y/shared.js'

export const DOM_PROPS = [
  'acceptCharset', 'accessKey', 'allowFullscreen', 'colSpan', 'controlsList', 'crossOrigin',
  'dateTime', 'defaultChecked', 'defaultMuted', 'defaultPlaybackRate', 'defaultSelected',
  'defaultValue', 'dirName', 'disablePictureInPicture', 'disableRemotePlayback', 'enterKeyHint',
  'fetchPriority', 'formAction', 'formEnctype', 'formMethod', 'formNoValidate', 'formTarget',
  'htmlFor', 'httpEquiv', 'imageSizes', 'imageSrcset', 'innerHTML', 'inputMode', 'isMap',
  'maxLength', 'minLength', 'noModule', 'noValidate', 'playsInline', 'readOnly', 'referrerPolicy',
  'rowSpan', 'textContent', 'useMap', 'writingSuggestions', 'autocapitalize', 'autocomplete',
  'autocorrect', 'autoplay', 'enctype', 'hreflang', 'srcdoc', 'srclang', 'srcset',
]
const BY_LOWER = new Map(DOM_PROPS.map((p) => [p.toLowerCase(), p]))
// the pragma's attribute names (src/pragma/index.ts ATTRS, BOOLISH)
const ATTRS = /^(for|form|list|role|tabindex|popovertarget(action)?|command(for)?|closedby|interestfor|anchor|aria-.*)$/
const BOOLISH = /^(spellcheck|draggable|contenteditable)$/i

export default {
  id: 'dom-prop-case',
  codes: ['SYG107'],
  description: 'DOM property name in the wrong case',
  run(project, report) {
    for (const p of project.scanned) {
      const file = project.files.get(p)
      if (!file) continue
      // the elements inside an <svg> (their names are attributes)
      const svg = new Set()
      walk(file.ast.program, (n) => {
        if (n.type !== 'JSXElement' || jsxName(n.openingElement.name) !== 'svg') return true
        walk(n, (m) => { if (m.type === 'JSXElement') svg.add(m); return true })
        return false
      })
      walk(file.ast.program, (n) => {
        if (n.type !== 'JSXElement' || svg.has(n)) return true
        const tag = jsxName(n.openingElement.name)
        if (!tag || !/^[a-z][a-z0-9]*$/.test(tag)) return true
        for (const a of n.openingElement.attributes) {
          if (a.type !== 'JSXAttribute' || a.name.type !== 'JSXIdentifier') continue
          const name = a.name.name
          const good = BY_LOWER.get(name.toLowerCase())
          if (!good || good === name || ATTRS.test(name) || BOOLISH.test(name)) continue
          report({
            code: 'SYG107',
            component: componentName(project, file, n),
            file,
            node: a,
            message: `${name} on <${tag}> is not a property of the element, so the browser ignores it: the DOM property is ${good}`,
            fix: `write ${good} (Sygnal sets a name on an HTML element as the DOM property of that name, in that case)`,
            data: { name, property: good, tag },
            fixes: [{ title: `Rename ${name} to ${good}`, kind: 'quickfix', preferred: true, fixAll: true, edits: [{ file: file.path, start: a.name.start, end: a.name.end, text: good }] }],
          })
        }
        return true
      })
    }
  },
}
