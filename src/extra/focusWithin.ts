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
 * SYG640 when nothing in the view, children included, matches). A fragment-rooted sender
 * searches its first root element.
 */

/** An ELEMENT target: `{ focus: focusWithin('.title') }` focuses `.title` anywhere under the sender's root, children included. */
export const focusWithin = (selector: string): any => ({
  within: selector,
  toString: () => '',
  spec: {commands: {focus: (root: any, o: any) => {
    const el = root.matches?.(selector) ? root : root.querySelector?.(selector)
    el?.focus(o)
  }}},
})
