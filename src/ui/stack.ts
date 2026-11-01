/*
 * UI sweep round 4: the layer stack's entries alone (layers.ts adds the listeners that dismiss).
 * One stack per page on a global, shared by sygnal/ui and the Zag parts' bundles, which each have
 * their own copy of this file: a Zag part only adds and removes its layer (Zag dismisses it), so it
 * doesn't carry the listeners, which only controlled layers (sygnal/ui's, installing them) need.
 */
const G: any = globalThis
export const S: any = (G[Symbol.for('sygnal.layers')] ||= {stack: []})
/** `el` closed */
export const pull = (el: any) => {
  const i = S.stack.findIndex((l: any) => l.el === el)
  i < 0 || S.stack.splice(i, 1)
}
/** `el` opened: on top of the stack (again) */
export const add = (el: any, l: any) => {
  pull(el)
  S.stack.push({el, ...l})
}
