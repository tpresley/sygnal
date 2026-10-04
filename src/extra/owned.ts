/**
 * PLAN-4.5 G-275: marks an initial state that a wrapper built from its caller's values (an
 * element's host props, Vike's pageContext.data or hydrated state, renderComponent's
 * initialState option). The dev statics freeze (D152, checks/statics.ts) leaves a marked object
 * and everything in it alone: the caller may still change those values. A non-enumerable symbol
 * key: spreads, JSON and Object.keys don't see it.
 */
export const OWNED = Symbol.for('sygnal.owned')

export const owned = <T>(v: T): T => {
  // G-289: an object that refuses the key (a Proxy) is returned as is
  try { if (v && typeof v == 'object' && Object.isExtensible(v)) Object.defineProperty(v, OWNED, {value: 1}) } catch {}
  return v
}

/**
 * G-289: owned() of a shallow copy of a plain object or array (the caller's own object stays
 * unmarked: it may be a component's static, which the freeze must still cover, or sealed, which
 * can't be marked); anything else as owned()
 */
export const ownedCopy = <T>(v: T): T => {
  const p = v && typeof v == 'object' ? Object.getPrototypeOf(v) : 0
  return owned(Array.isArray(v) ? [...v] as any : p == Object.prototype || p === null ? {...v} : v)
}
