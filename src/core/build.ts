/**
 * PLAN-4.6 D175 (R2-R4; deleted at R5): production builds strip the next core. `sygnal/vite`
 * defines `__SYGNAL_NEXT_CORE__` as `false` in `vite build` (unless the project defines it
 * itself: the benchmarks' `next` target sets `true`), so run()'s and renderComponent's next-core
 * branch is dead code there and the next core tree-shakes away: the size gate keeps measuring the
 * shipped core. Undefined (dev, tests, other bundlers): the branch stays, selected at runtime by
 * the internal `globalThis.__SYGNAL_CORE__ = 'next'` flag.
 */
declare const __SYGNAL_NEXT_CORE__: boolean | undefined

/** the next core may run (false only in a production build that stripped it) */
export const NEXT_CORE: boolean = typeof __SYGNAL_NEXT_CORE__ === 'undefined' ? true : !!__SYGNAL_NEXT_CORE__

