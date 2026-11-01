/**
 * Cross-platform primitives (experiment B): a small neutral vocabulary of host tags that each
 * renderer maps to its own elements, plus control specs so intents select them by identity.
 *
 *   tag        web (mapTags)                 terminal (native)    React Native (reactBridge table)
 *   view       div                           block                View
 *   row        div.row (flex-direction: row) block                View {flexDirection: 'row'}
 *   txt        span                          inline text          Text
 *   pressable  button type=button            [label], Enter/Space Pressable (onPress → click)
 *   textinput  input                         [value_], typing     TextInput (onChangeText → input)
 *   toggle     input type=checkbox           [x] / [ ]            Switch (onValueChange → click+change)
 *
 * Events keep the DOM's names and shapes (click, input, change, keydown; e.target.value /
 * .checked), so `.value()`, `.checked()`, processForm and every existing intent helper work on
 * all of them: the renderer translates its native events into these (README §3, D-AR-3).
 *
 * Why not `text`: the pragma treats `text` as an SVG tag (src/pragma svgTags) and puts it in the
 * SVG namespace. Why not `s-view`: a hyphenated tag is a custom element to the pragma (bit 8) and a
 * possible form-associated field to the controlled-input module.
 */
const tag = (t: string, extra?: (props: any) => any) => {
  const prim: any = () => {}
  prim.__sygnalControl = (data: any, children: any[], h: any) => h(t, extra ? {...extra(data || {}), ...data} : data, ...children)
  prim.toString = () => t
  return prim
}

/** layout and text: JSX tags (no data-control stamp) */
export const View = tag('view')
export const Row = tag('row')
export const Txt = tag('txt')

/** interactive: control specs, `controls({ Add: Pressable, Draft: TextInput })` */
const spec = (t: string) => ({kind: t, vnode: (props: any, children: any[], h: any) => h(t, props, ...children)})
export const Pressable = spec('pressable')
export const TextInput = spec('textinput')
export const Toggle = spec('toggle')

/** the web's table: neutral tag → [tag, props added] */
export const webTags: Record<string, [string, Record<string, any>?]> = {
  view: ['div'],
  row: ['div', {style: {display: 'flex', flexDirection: 'row', gap: '0.5em'}}],
  txt: ['span'],
  pressable: ['button', {attrs: {type: 'button'}}],
  textinput: ['input'],
  toggle: ['input', {attrs: {type: 'checkbox'}}],
}

/**
 * A driver wrapper that rewrites neutral tags before the patch (memoized per vnode: the core keeps
 * unchanged subtrees by identity, so an unchanged subtree maps to the same copy and snabbdom skips it)
 */
export function mapTags(driver: any, table: Record<string, [string, Record<string, any>?]>) {
  const memo = new WeakMap<object, any>()
  const map = (v: any): any => {
    if (!v || typeof v != 'object') return v
    const hit = memo.get(v)
    if (hit) return hit
    let out = v
    const kids = v.children && v.children.map(map)
    const changedKids = kids && kids.some((k: any, i: number) => k !== v.children[i])
    const m = v.sel && /^([a-z]+)(.*)$/.exec(v.sel)
    const row = m && table[m[1]]
    if (row || changedKids) {
      const [t, add] = row || [m ? m[1] : '']
      const data = add ? merge(add, v.data || {}) : v.data
      out = {sel: row ? t + m![2] : v.sel, data, children: kids, text: v.text, elm: undefined, key: v.key}
    }
    memo.set(v, out)
    return out
  }
  return (vnode$: any, name: string) => driver(vnode$.map(map), name)
}
const merge = (a: any, b: any) => {
  const out: any = {...b}
  for (const k in a) out[k] = {...a[k], ...b[k]}
  return out
}
