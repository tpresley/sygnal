/**
 * G-803: the shell components of a page (its Wrappers and Layouts), outermost first, with their
 * state keys. Shared by onRenderHtml and onRenderClient so the server and the client nest them
 * the same way.
 *
 * Vike's cumulative configs (`Layout` and `Wrapper` are, see +config.ts) list the values closest
 * to the page first: pages/admin/+Layout before pages/+Layout (vike's resolveVikeConfigInternal:
 * sortAfterInheritanceOrder puts the longer inheritance root first). So the root's come last, and
 * the shell reverses each list: every Wrapper outside every Layout (as vike-react), and within each
 * the root's outermost. Keys count from the outside in (wrapper_0, ..., layout_0, ...), so a root
 * Layout keeps `layout_0` on every page, nested or not.
 */
export interface ShellPart { comp: any; key: string }

const comps = (val: any): any[] =>
  (val ? (Array.isArray(val) ? val : [val]) : []).filter((c: any) => typeof c === 'function')

export function shellOf(config: { Wrapper?: any; Layout?: any }): ShellPart[] {
  return [
    ...comps(config.Wrapper).reverse().map((comp, i) => ({ comp, key: 'wrapper_' + i })),
    ...comps(config.Layout).reverse().map((comp, i) => ({ comp, key: 'layout_' + i })),
  ]
}

/**
 * PLAN-4 G-207: the uid() path part of a shell component or the Page: wrapper_0 → 'w0',
 * layout_1 → 'l1', page → 'p'. onRenderClient gives it as the nested vnode's `id` prop, so the
 * Page's uid is 'u-w0-l0-p' however the shell nests it; onRenderHtml renders each one with the
 * same root (renderToString's `uid`), so server and client ids match.
 */
export function uidPart(key: string): string {
  return key == 'page' ? 'p' : key[0] + key.slice(key.indexOf('_') + 1)
}
