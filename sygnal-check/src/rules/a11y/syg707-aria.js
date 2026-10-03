/**
 * SYG707: an aria-* attribute that doesn't exist (usually a typo:
 * aria-lable, aria-labeledby), or a role value that isn't a WAI-ARIA role
 * (a typo, or an abstract role such as "widget"). Static lists from WAI-ARIA
 * 1.2, plus the 1.3 additions browsers already support and the DPUB-ARIA /
 * Graphics-ARIA role modules (doc-*, graphics-*). Dynamic role values are not
 * checked.
 */
import { attrString, elementsOf, componentName } from './shared.js'
import { editDistance } from '../../names.js'

export const ARIA_ATTRIBUTES = new Set([
  'aria-activedescendant', 'aria-atomic', 'aria-autocomplete', 'aria-braillelabel', 'aria-brailleroledescription',
  'aria-busy', 'aria-checked', 'aria-colcount', 'aria-colindex', 'aria-colindextext', 'aria-colspan', 'aria-controls',
  'aria-current', 'aria-describedby', 'aria-description', 'aria-details', 'aria-disabled', 'aria-dropeffect',
  'aria-errormessage', 'aria-expanded', 'aria-flowto', 'aria-grabbed', 'aria-haspopup', 'aria-hidden', 'aria-invalid',
  'aria-keyshortcuts', 'aria-label', 'aria-labelledby', 'aria-level', 'aria-live', 'aria-modal', 'aria-multiline',
  'aria-multiselectable', 'aria-orientation', 'aria-owns', 'aria-placeholder', 'aria-posinset', 'aria-pressed',
  'aria-readonly', 'aria-relevant', 'aria-required', 'aria-roledescription', 'aria-rowcount', 'aria-rowindex',
  'aria-rowindextext', 'aria-rowspan', 'aria-selected', 'aria-setsize', 'aria-sort', 'aria-valuemax', 'aria-valuemin',
  'aria-valuenow', 'aria-valuetext',
])

export const ARIA_ROLES = new Set([
  'alert', 'alertdialog', 'application', 'article', 'banner', 'blockquote', 'button', 'caption', 'cell', 'checkbox',
  'code', 'columnheader', 'combobox', 'comment', 'complementary', 'contentinfo', 'definition', 'deletion', 'dialog',
  'directory', 'document', 'emphasis', 'feed', 'figure', 'form', 'generic', 'grid', 'gridcell', 'group', 'heading',
  'image', 'img', 'insertion', 'link', 'list', 'listbox', 'listitem', 'log', 'main', 'mark', 'marquee', 'math', 'menu',
  'menubar', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'meter', 'navigation', 'none', 'note', 'option',
  'paragraph', 'presentation', 'progressbar', 'radio', 'radiogroup', 'region', 'row', 'rowgroup', 'rowheader',
  'scrollbar', 'search', 'searchbox', 'sectionfooter', 'sectionheader', 'separator', 'slider', 'spinbutton', 'status',
  'strong', 'subscript', 'suggestion', 'superscript', 'switch', 'tab', 'table', 'tablist', 'tabpanel', 'term',
  'textbox', 'time', 'timer', 'toolbar', 'tooltip', 'tree', 'treegrid', 'treeitem',
])

// Abstract roles: authors must not use them (WAI-ARIA 1.2 §5.3.2)
const ABSTRACT_ROLES = new Set(['command', 'composite', 'input', 'landmark', 'range', 'roletype', 'section', 'sectionhead', 'select', 'structure', 'widget', 'window'])

const isRole = (r) => ARIA_ROLES.has(r) || /^(doc|graphics)-[a-z]+$/.test(r)

function closest(word, set) {
  let best = null
  let bestD = Infinity
  for (const w of set) {
    const d = editDistance(word, w)
    if (d < bestD) { bestD = d; best = w }
  }
  return bestD <= Math.max(2, Math.floor(word.length / 4)) ? best : null
}

export default {
  id: 'a11y-aria',
  codes: ['SYG707'],
  description: 'Unknown aria-* attribute or invalid role',
  run(project, report) {
    for (const info of elementsOf(project)) {
      if (info.kind !== 'html' && info.kind !== 'control') continue
      const component = componentName(project, info.file, info.el)
      for (const [name, a] of info.attrs) {
        const lower = name.toLowerCase()
        if (lower.startsWith('aria-') && !ARIA_ATTRIBUTES.has(lower)) {
          const near = closest(lower, ARIA_ATTRIBUTES)
          report({
            code: 'SYG707', component, file: info.file, node: a.node,
            message: `${name} is not an ARIA attribute, so assistive technology ignores it`,
            fix: near ? `did you mean ${near}?` : 'use an attribute from the WAI-ARIA list (https://www.w3.org/TR/wai-aria-1.2/#state_prop_def), or a data-* attribute for your own data',
            data: { attribute: name, suggestion: near || undefined },
          })
        }
        if (lower === 'role') {
          const v = attrString(a)
          if (v == null || !v.trim()) continue
          const bad = v.trim().split(/\s+/).filter(r => !isRole(r.toLowerCase()))
          if (!bad.length) continue
          const r = bad[0]
          const abstract = ABSTRACT_ROLES.has(r.toLowerCase())
          const near = abstract ? null : closest(r.toLowerCase(), ARIA_ROLES)
          report({
            code: 'SYG707', component, file: info.file, node: a.node,
            message: abstract
              ? `role="${v}" uses the abstract role '${r}', which authors may not use; assistive technology ignores it`
              : `role="${v}": '${r}' is not a WAI-ARIA role, so assistive technology ignores it`,
            fix: abstract ? 'use a concrete role (e.g. button, checkbox, tab, region) or none' : near ? `did you mean role="${near}"?` : 'use a role from the WAI-ARIA list (https://www.w3.org/TR/wai-aria-1.2/#role_definitions), or remove it',
            data: { role: r, suggestion: near || undefined },
          })
        }
      }
    }
  },
}
