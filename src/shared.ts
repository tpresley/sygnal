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
 * P45-D: sources that aren't drivers get no sinks: props$, children$, dispose$, commands$, CHILD;
 * PARENT, EFFECT and ELEMENT are built-in sinks; __k, __d, __uid... are internal
 */
export const NOT_SINK = /^(__|(props|children|dispose|commands)\$$|(CHILD|PARENT|EFFECT|ELEMENT)$)/
