/**
 * PLAN-4.6 core: the ClientOnly marker (R2), registered on import by the public `ClientOnly`
 * module (sygnal/vike). On the client it is unwrapped, as today: one child stands in its place
 * (at the marker's path), none renders an empty div, several are wrapped in a div. SSR renders
 * its fallback (extra/ssr.ts, unchanged).
 */
import {pres} from '../registry'

pres.clientonly = (n) => {
  const c = n.children || []
  if (c.length < 2) return c.length ? c[0] : {sel: 'div', data: {}, children: [], text: undefined, elm: undefined, key: undefined}
  return {sel: 'div', data: {}, children: c, text: undefined, elm: undefined, key: undefined}
}
