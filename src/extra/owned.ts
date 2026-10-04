/**
 * PLAN-4.5 G-275: marks an initial state that a wrapper built from its caller's values (an
 * element's host props, Vike's pageContext.data or hydrated state, renderComponent's
 * initialState option). The dev statics freeze (D152, checks/statics.ts) leaves a marked object
 * and everything in it alone: the caller may still change those values. A non-enumerable symbol
 * key: spreads, JSON and Object.keys don't see it.
 */
export const OWNED = Symbol.for('sygnal.owned')

export const owned = <T>(v: T): T => {
  if (v && typeof v == 'object' && Object.isExtensible(v)) Object.defineProperty(v, OWNED, {value: 1})
  return v
}
