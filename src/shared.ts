/*
 * Tiny helpers shared by the core and the helper modules (behaviors, undo, the dev entry), kept
 * out of the core so importing them never pulls it in.
 */

/** The "no change / send nothing" sentinel (a registered symbol: the same in every copy) */
export const ABORT = Symbol.for('sygnal.ABORT')

/**
 * Whether a value is ABORT. Compares the description, not the identity, in case bundlers (e.g.
 * Vite) create duplicate module instances with separate Symbol.for() registries. (G-214: the
 * one copy, for the core, behaviors, undo and the action log)
 */
export const isAbort = (v: any): boolean => typeof v == 'symbol' && v.description == 'sygnal.ABORT'

/**
 * Set on a dev-only wrapper of a model function (SYG222's) to the function it wraps, so the
 * action log and t.explain() show the user's reducer (G-214 follow-up)
 */
export const ORIGINAL = Symbol.for('sygnal.original')

/**
 * PLAN-4 GS-9 / G-214: one part of a uid() path (a child's path or `id` prop, a Collection item
 * key, a Switchable page name), encoded injectively into [A-Za-z0-9_]: letters and digits stay,
 * anything else (including '_' and '-') becomes '_<UTF-16 code>_' ('0.2' → '0_46_2', 'a_b' →
 * 'a_95_b'), so the '-' between parts is unambiguous too. renderToString encodes the same way
 * (ssr.ts).
 */
export const uidPart = (s: any): string => (s + '').replace(/\W|_/g, c => '_' + c.charCodeAt(0) + '_')

/**
 * PLAN-5 A-1: a Collection item's style with its view-transition name and class
 * (`viewTransitionName="card"`): `card-<id>`, the id escaped as uidPart does (a valid CSS
 * identifier, unique per id), and the class `card`; the item's own style wins, except its
 * `undefined` values (G-418: no value is no override; snabbdom would leave the old one). The
 * core's Collection host and SSR share it
 */
export const vtStyle = (p: string, id: any, style?: any) => {
  const o: any = {viewTransitionName: p + '-' + uidPart(id), viewTransitionClass: p}
  for (const k in style) if (style[k] !== undefined) o[k] = style[k]
  return o
}

/**
 * P45-D: sources that aren't drivers get no sinks: props$, children$, dispose$, commands$, CHILD;
 * PARENT, EFFECT and ELEMENT are built-in sinks; __k, __d, __uid... are internal
 */
export const NOT_SINK = /^(__|(props|children|dispose|commands)\$$|(CHILD|PARENT|EFFECT|ELEMENT)$)/

/**
 * PLAN-6 A-1 (D259): ABORT with a reason, for an agent's tool result. `abort('already done')`
 * returns ABORT (the core sees only that: no change, nothing sent) and leaves the reason here,
 * where the agent layer's handler wrapper reads and clears it. Tree-shaken from apps that don't
 * use it (0 core bytes)
 */
export const abortReason: {r?: string} = {}
export const abort = (reason?: string): typeof ABORT => (abortReason.r = reason, ABORT)
