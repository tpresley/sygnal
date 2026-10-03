/**
 * SYG421 — invalid `data` (dataset) key in a view (error, G-143).
 *
 * JSX `data={{ ... }}` becomes the vnode's `data.dataset` (a `data-x-y="..."` attribute is
 * camelCased to 'xY' by the pragma, G-152), which the DOM driver writes with
 * `element.dataset[key] = value`. The browser throws a SyntaxError DOMException for a key with
 * a hyphen followed by a lower-case letter (`'task-id'`), and setAttribute() throws for a name
 * with characters an attribute can't have (spaces, quotes, `=`, ...). The patch fails, so the
 * app stops rendering, and the console shows only a bare "DOMException {}".
 *
 * Mechanism: onRender (before the DOM driver patches) walks the rendered vnode tree and checks
 * every dataset key. Reported once per key; the mock DOM of renderComponent never throws, so
 * this is also the only signal there.
 */
import type {DiagnosticCheck} from '../index'
import {devReport, once, nameOf} from './shared'

const camel = (key: string): string => key.replace(/-([a-z])/g, (_, c) => c.toUpperCase())
const BAD_CHAR = /[\s"'<>\/=`]/

function problem(key: string): string | undefined {
  if (/-[a-z]/.test(key)) return `has a hyphen followed by a lower-case letter, which a dataset name can't have`
  if (BAD_CHAR.test(key)) return `contains a character an HTML attribute name can't have`
  return undefined
}

function walk(vnode: any, visit: (dataset: Record<string, any>, sel: string) => void, depth = 0): void {
  if (!vnode || typeof vnode != 'object' || depth > 500) return
  const ds = vnode.data && vnode.data.dataset
  if (ds && typeof ds == 'object') visit(ds, vnode.sel)
  const children = vnode.children
  if (Array.isArray(children)) for (const c of children) walk(c, visit, depth + 1)
}

export const datasetCheck: DiagnosticCheck = {
  id: 'dataset',

  onRender(component, rootVnode) {
    walk(rootVnode, (dataset, sel) => {
      for (const key of Object.keys(dataset)) {
        const why = problem(key)
        if (!why || !once(`SYG421:${key}`)) continue
        const good = camel(key).replace(new RegExp(BAD_CHAR.source, 'g'), '')
        const attr = good.replace(/[A-Z]/g, c => '-' + c.toLowerCase())
        const name = good || 'name'
        devReport('SYG421', {
          component,
          message: `The view of ${nameOf(component)} renders the data key '${key}'${sel ? ` on <${String(sel).split(/[.#]/)[0]}>` : ''} ` +
            `(from data={{ '${key}': … }}), but '${key}' ${why}. ` +
            `Writing it throws a DOMException, which can stop rendering`,
          fix: `Use a camelCase key in the data prop: data={{ ${name}: … }} renders the attribute data-${attr || 'name'}; read it with .data('${name}')`,
          data: {key, suggested: good, attribute: `data-${attr}`},
        })
      }
    })
  },
}
