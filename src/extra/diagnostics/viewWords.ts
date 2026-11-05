/**
 * The words rule of the SYG103 / SYG104 noise control, shared by the dev runtime checks
 * (checks/dom.ts) and renderComponent: a selector whose class / id / tag / attribute words all
 * appear in the component's view source, or in the words sygnal/vite registered for it (its
 * module's and its relative imports' markup), may match an element the component draws
 * (conditionally). No imports: renderComponent (the main bundle) uses it too.
 */
const viewTokens = new WeakMap<object, string>()

/**
 * The view's source, plus the words sygnal/vite registered for the component (its module's and
 * its relative imports' string literals: markup a view helper draws), when it did
 */
export function viewSource(component: any): string {
  const view = component && component.view
  if (typeof view !== 'function') return ''
  let src = viewTokens.get(view)
  if (src === undefined) {
    try { src = Function.prototype.toString.call(view) } catch (_) { src = '' }
    const registered = (globalThis as any).__SYGNAL_VIEW_TOKENS__?.get?.(view)
    if (typeof registered == 'string') src += '\n' + registered
    viewTokens.set(view, src as string)
  }
  return src as string
}

const words = (s: string): string[] => s.match(/[A-Za-z_][\w-]*/g) || []

/** class / id / tag tokens of a selector: '.a .b-c > #d' -> ['a', 'b-c', 'd'] */
export const tokensOf = (selector: string): string[] =>
  words(selector.replace(/\[[^\]]*\]|:[\w-]+(\([^)]*\))?/g, ' '))
    .concat(...Array.from(selector.matchAll(/\[\s*([\w-]+)\s*(?:[~|^$*]?=\s*(?:"([^"]*)"|'([^']*)'|([^\]\s]*)))?[^\]]*\]/g), m =>
      // CT-1: a control's key (`<Add>` / `h(Add)` in the view source)
      m[1] == 'data-control' ? words(m[2] ?? m[3] ?? m[4] ?? '')
      // Sift (after preview.6): an attribute's name and its value's words (`[data-act="remove"]`);
      // a data-* name may be written as its dataset key instead (`data={{ act }}`): `a|b` either
      : [m[1].startsWith('data-') ? m[1] + '|' + m[1].slice(5).replace(/-(\w)/g, (_, c) => c.toUpperCase()) : m[1], ...words(m[2] ?? m[3] ?? m[4] ?? '')]))

export function appearsInView(component: any, selector: string): boolean {
  const src = viewSource(component)
  if (!src) return false
  const tokens = tokensOf(selector)
  if (!tokens.length) return false
  return tokens.every(t => t.split('|').some(a => new RegExp(`(^|[^\\w-])${a.replace(/[-]/g, '\\-')}($|[^\\w-])`).test(src)))
}
