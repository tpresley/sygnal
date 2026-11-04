/**
 * SYG107 — a DOM property name with the wrong case on an HTML element (warn; Sift preview.5
 * #2, #3).
 *
 * The pragma sets a JSX name on an HTML element as a DOM property, as written (attributes are
 * `attrs-x`, `aria-*`, `role`, `tabindex`, `for` and the popover / invoker ones; `spellcheck`,
 * `draggable` and `contenteditable` in any case). A name the element has no property for is an
 * expando: nothing is rendered and nothing fails. The likely cause is the case: React's
 * `autoComplete`, `autoPlay`, `srcSet`, `hrefLang`, `encType` (the DOM's are lowercase), or
 * the attribute's lowercase `inputmode`, `maxlength`, `readonly`, `colspan` (the DOM's are
 * camelCase).
 *
 * Mechanism: onRender (before the DOM driver patches) walks the rendered vnode tree (HTML
 * elements: no SVG namespace, no custom element) and checks every props key against DOM_PROPS,
 * the case-sensitive HTML property names whose case people get wrong. Reported once per
 * name and tag. sygnal-check's rules/syg107-dom-prop-case.js has the same table
 * (test/syg107-dom-prop-case.test.js keeps them equal).
 */
import type {DiagnosticCheck} from '../index'
import {devReport, once, nameOf} from './shared'

/** HTML DOM properties whose case is easy to get wrong (Chromium's settable ones, without aria*, obsolete ones and the pragma's attributes) */
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
const BY_LOWER = new Map(DOM_PROPS.map(p => [p.toLowerCase(), p]))

/** the property a JSX name on an HTML element meant, when it differs from the name only in case */
export const meant = (name: string): string | undefined => {
  const p = BY_LOWER.get(name.toLowerCase())
  return p !== name ? p : undefined
}

function walk(vnode: any, visit: (props: Record<string, any>, tag: string) => void, depth = 0): void {
  if (!vnode || typeof vnode != 'object' || depth > 500) return
  const d = vnode.data, tag = typeof vnode.sel == 'string' ? vnode.sel.split(/[.#]/)[0] : ''
  // SVG elements get attributes (the pragma), custom elements their own properties
  if (d?.ns || tag == 'svg') return
  if (d?.props && tag && !tag.includes('-')) visit(d.props, tag)
  const children = vnode.children
  if (Array.isArray(children)) for (const c of children) walk(c, visit, depth + 1)
}

export const domPropsCheck: DiagnosticCheck = {
  id: 'domProps',

  onRender(component, rootVnode) {
    walk(rootVnode, (props, tag) => {
      for (const key of Object.keys(props)) {
        const good = meant(key)
        if (!good || !once(`SYG107:${tag}:${key}`)) continue
        devReport('SYG107', {
          component,
          message: `The view of ${nameOf(component)} renders ${key} on <${tag}>, which the element has no property for, so the browser ignores it. The DOM property is ${good}`,
          fix: `Write ${good}={…} (Sygnal sets a name on an HTML element as the DOM property of that name, in that case)`,
          data: {name: key, property: good, tag},
        })
      }
    })
  },
}
