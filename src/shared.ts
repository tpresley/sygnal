/*
 * Tiny helpers shared by the core and the helper modules (behaviors, undo, the dev entry), kept
 * out of component.ts so importing them never pulls the core in.
 */

/**
 * PLAN-4 GS-9 / G-214: one part of a uid() path (a child's path or `id` prop, a Collection item
 * key, a Switchable page name), encoded injectively into [A-Za-z0-9_]: letters and digits stay,
 * anything else (including '_' and '-') becomes '_<UTF-16 code>_' ('0.2' → '0_46_2', 'a_b' →
 * 'a_95_b'), so the '-' between parts is unambiguous too. renderToString encodes the same way
 * (ssr.ts).
 */
export const uidPart = (s: any): string => (s + '').replace(/\W|_/g, c => '_' + c.charCodeAt(0) + '_')
