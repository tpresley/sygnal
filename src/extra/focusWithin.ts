/*
 * PLAN-5 D194: focusWithin(selector), an ELEMENT target for focusing an element inside the
 * sender's children (a child component's field, an input in a Collection item):
 *
 *   ADD:    { STATE: addRow, ELEMENT: (s) => ({ focus: focusWithin(`[data-id="${s.next}"] .title`) }) },
 *   SUBMIT: { ELEMENT: { focus: focusWithin('[name="email"]'), preventScroll: true } },
 *
 * A plain `{ focus: '.x' }` is resolved in the sender's isolated scope, so it can't reach into
 * a child. This target selects the sender's root element (its selector is '') and declares a
 * `focus` spec command (D102, elementCommands.ts) that focuses the first element under the root
 * matching `selector` (the root itself if it matches), with the command's options. 0 B core.
 *
 * It runs after the next patch, as every element command: a Collection item added by the same
 * action is on the page by then. No match: nothing happens (renderComponent's mock DOM reports
 * SYG640 when nothing in the view, children included, matches).
 * 7.3 (Sift): the target finds the element itself (`spec.el`, elementCommands.ts) under every
 * top-level element of the sender, its own and its children's (a fragment-rooted sender whose
 * only remaining root is a child component has no root element of its own): the DOM driver
 * keeps each scope's root elements in its isolate module's tree, under the sender's scope path.
 * No match: the sender's own root as before (another DOM source: sygnal/host), and without one
 * the command waits for a patch and then reports SYG640 (dev).
 */

// the top-level elements of the scope at `ns` and of every scope under it (the DOM driver's
// IsolateModule tree: [elements, children by scope]); none without that driver (sygnal/host)
const tops = (d: any): any[] => {
  const m = d?._isolateModule, t = m?.namespaceTree
  let n = t?.tree
  for (const s of d?._namespace || []) if (n && s.type != 'selector') n = n[1][t.mapper(s)]
  const out: any[] = []
  const walk = (x: any) => { x[0]?.forEach((e: any) => out.push(e)); for (const k in x[1]) walk(x[1][k]) }
  n && walk(n)
  return out.filter(e => !out.some(o => o != e && o.contains(e)))
}

/** An ELEMENT target: `{ focus: focusWithin('.title') }` focuses `.title` anywhere under the sender's root, children included. */
export const focusWithin = (selector: string): any => ({
  within: selector,
  toString: () => '',
  spec: {
    el: (c: any) => {
      for (const e of tops(c.sources[c.DOMSourceName])) { const el = e.matches?.(selector) ? e : e.querySelector?.(selector); if (el) return el }
    },
    commands: {focus: (root: any, o: any) => {
      const el = root.matches?.(selector) ? root : root.querySelector?.(selector)
      el?.focus(o)
    }},
  },
})
