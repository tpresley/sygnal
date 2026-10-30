/*
 * 'sygnal/react-native': a Sygnal app on React Native. The app renders into a sygnal/host tree
 * (the kit the terminal and agent UI targets use); this bridge renders that tree as React Native
 * components, and turns native callbacks into the DOM events intents already listen for (D-AR-3):
 * onPress → click, onChangeText → input, onValueChange → click + input + change, onScroll → scroll.
 *
 *   import { SygnalView } from 'sygnal/react-native'
 *   export default () => <SygnalView app={App} styles={[['.done', { opacity: 0.5 }]]} />
 *
 * - Incremental: each host element is a memoized React component keyed by its host node and
 *   revision (the host's change tracking: a mutation moves the revision of the node and its
 *   ancestors), so a change re-renders the changed path only (`incremental: false`: every element,
 *   for comparison; `onNodeRender` counts).
 * - What maps to what: the 'sygnal/primitives' (by their data-primitive marker), the common HTML
 *   tags (a web view runs as is: div → View, span/p/h1 → Text, button → Pressable, input →
 *   TextInput or Switch, img → Image, select → a Pressable that steps through the options), and a
 *   target's own field tags (registerFieldTags: text → TextInput, checkbox → Switch). `components`
 *   replaces any of them.
 * - Controlled fields: a field's value is read from the host element when React renders it, never
 *   captured earlier, so React Native's own TextInput protocol (the native event count) keeps
 *   typing ahead of a render that hasn't seen it yet; the app's value wins whenever it differs.
 * - Styles: the `styles` rules ([selector, style], after defaultNativeStyles) compile to a
 *   StyleSheet; an element's style is its matching rules, then its inline style (`px` strings
 *   from the primitives' web form read back as numbers). Text keys (color, fontSize, …) of a
 *   View-like element style the Text that wraps its direct text (React Native has no inheritance
 *   from a View).
 * - Lists: a `List` primitive renders as a FlatList over its children (native views windowed; the
 *   Sygnal items stay mounted). VirtualCollection measures the DOM and is web-only.
 *
 * Separate entry: './index' and './host' become the external 'sygnal' and 'sygnal/host'; react
 * and react-native are optional peer dependencies (D209).
 */
import {createElement as h, memo, useState, useReducer, useEffect} from 'react'
import {View, Text, Pressable, TextInput, Switch, Image, ScrollView, FlatList, StyleSheet} from 'react-native'
import {run} from './index'
import {HostDocument, makeHostDriver, nodeId, matches, activate, pressKey, chooseOption, optionValue, isTextField, isCheckable, HostEvent} from './host'
import type {HostElement, HostNode} from './host'

export type NativeStyle = Record<string, any>
export type NativeStyleRule = [selector: string, style: NativeStyle]

/** HTML defaults for native (a web view's headings, links, buttons and fields look like themselves) */
export const defaultNativeStyles: NativeStyleRule[] = [
  ['h1', {fontSize: 32, fontWeight: '700', marginVertical: 8}],
  ['h2', {fontSize: 24, fontWeight: '700', marginVertical: 6}],
  ['h3', {fontSize: 20, fontWeight: '600', marginVertical: 4}],
  ['h4, h5, h6', {fontSize: 17, fontWeight: '600'}],
  ['strong, b, th', {fontWeight: '700'}],
  ['em, i', {fontStyle: 'italic'}],
  ['a', {color: '#2f6fed', textDecorationLine: 'underline'}],
  // HTML elements only: a primitive (data-primitive) is styled by the app, as in React Native
  ['button:not([data-primitive])', {paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8, backgroundColor: '#2f6fed', color: '#ffffff', fontWeight: '600', fontSize: 17, alignItems: 'center', justifyContent: 'center'}],
  ['button[disabled]', {opacity: 0.5}],
  ['input:not([data-primitive]):not([type="checkbox"]):not([type="radio"]), textarea:not([data-primitive])', {borderWidth: 1, borderColor: '#bbbbbb', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, fontSize: 17, minWidth: 160}],
  ['p, li', {fontSize: 17}],
  ['hr', {height: 1, backgroundColor: '#cccccc', marginVertical: 8}],
]

/** the text keys React Native applies to Text only */
const TEXT_KEYS = /^(color|font\w*|textAlign|textDecoration\w*|textTransform|letterSpacing|lineHeight|includeFontPadding|textShadow\w*|writingDirection|userSelect)$/
const PX = /^(-?\d*\.?\d+)px$/
/** a style value as React Native takes it: `12px` → 12 (the primitives' web form) */
const nativeValue = (v: any) => (typeof v == 'string' && PX.test(v) ? parseFloat(v) : v)
// web-only style the primitives add for the browser (a plain button look, line clamping): not React Native's
const WEB_ONLY = /^(background|font|cursor|boxSizing|outline\w*|transition\w*|Webkit\w*|whiteSpace|textOverflow|overflow)$/
const ownStyle = (el: HostElement) => {
  let out: NativeStyle | undefined
  for (const k in el.style) {
    const v = el.style[k]
    if (v == null || v === '' || v === 'inherit' || WEB_ONLY.test(k) || (k == 'display' && v != 'none' && v != 'flex')) continue
    ;(out ||= {})[k] = nativeValue(v)
  }
  return out
}

/** a component of the table: the element, its children as React nodes, its style (view part, text part) */
export type NativeComponent = (el: HostElement, children: any[], style: {view: NativeStyle, text: NativeStyle, all: NativeStyle}, ctx: NativeContext) => any
export interface NativeContext {
  /** fire a DOM-shaped event on a host element */
  fire(el: HostElement, type: string, init?: Record<string, any>): boolean
  /** a click and its default action (sygnal/host activate) */
  press(el: HostElement): void
  /** render a host child (a memoized element) */
  child(node: HostNode): any
}

export interface NativeHostOptions {
  /** the app's native stylesheet (after defaultNativeStyles) */
  styles?: readonly NativeStyleRule[]
  /** false: no defaultNativeStyles */
  defaultStyles?: boolean
  /** replace or add components, by primitive name ('View', 'List', …) or tag ('button', 'my-chart') */
  components?: Record<string, NativeComponent>
  /** a link's default action (an <a href> pressed): a router driver's go */
  onNavigate?: (href: string, el: HostElement) => void
  /** false: re-render every element on every change (for measuring) */
  incremental?: boolean
  /** called each time an element's React component renders (measuring, tests) */
  onNodeRender?: (el: HostElement) => void
  /** the root View's style (default { flex: 1 }) */
  style?: NativeStyle
}

const TEXTUAL = /^(span|p|label|strong|b|em|i|small|code|h[1-6]|a|li|th|td|dt|dd|figcaption|summary|legend|caption)$/
const INLINE = /^(span|strong|b|em|i|small|code|a|label|img|button|input|select|textarea|br)$/
const fireOn = (el: HostElement, type: string, init?: Record<string, any>) => el.dispatchEvent(new HostEvent(type, init))
const prim = (el: HostElement) => el.dataset.primitive as string | undefined

function split(all: NativeStyle) {
  const view: NativeStyle = {}, text: NativeStyle = {}
  for (const k in all) (TEXT_KEYS.test(k) ? text : view)[k] = all[k]
  return {view, text, all}
}
const has = (o: object) => { for (const _ in o) return true; return false }

/** the built-in table */
function defaultComponents(): Record<string, NativeComponent> {
  // direct strings become Text with the element's text style; element children render as they are
  const kids = (children: any[], text: NativeStyle) => children.map((c, i) => typeof c == 'string' ? h(Text, {key: 't' + i, style: has(text) ? text : undefined}, c) : c)
  // an HTML container of inline content (a <li> with a checkbox, a label and a button) flows in a row,
  // as the browser lays it out; a View primitive is a column unless its style says otherwise
  const view: NativeComponent = (el, c, s) => {
    const row = !prim(el) && s.view.flexDirection == null && el.children.length > 0 && el.childNodes.every(n => n.nodeType === 3 || INLINE.test((n as HostElement).localName) && !prim(n as HostElement) || prim(n as HostElement) == 'Text' || prim(n as HostElement) == 'Pressable' || prim(n as HostElement) == 'Switch')
    return h(View, {style: row ? [{flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8}, s.view] : s.view}, ...kids(c, s.text))
  }
  const text: NativeComponent = (el, c, s, ctx) => h(Text, {style: s.all, onPress: listensClick(el) ? () => ctx.press(el) : undefined, accessibilityRole: el.localName == 'a' ? 'link' : /^h\d$/.test(el.localName) ? 'header' : undefined}, ...c)
  const pressable: NativeComponent = (el, c, s, ctx) => h(Pressable, {
    onPress: () => ctx.press(el), disabled: el.disabled, accessibilityRole: 'button', accessibilityLabel: el.getAttribute('aria-label') || undefined,
    accessibilityState: {disabled: el.disabled},
    style: ({pressed}: {pressed: boolean}) => (pressed ? [s.view, {opacity: 0.6}] : s.view),
  }, ...kids(c, s.text))
  const textInput: NativeComponent = (el, _c, s, ctx) => h(TextInput, {
    // read now, at render: never a value captured before the latest native change was applied
    value: el.value,
    placeholder: el.getAttribute('placeholder') || undefined,
    secureTextEntry: el.type == 'password',
    multiline: el.localName == 'textarea',
    editable: !el.readOnly && !el.disabled,
    keyboardType: el.type == 'email' ? 'email-address' : el.getAttribute('inputmode') == 'numeric' || (el as any).inputMode == 'numeric' ? 'numeric' : undefined,
    accessibilityLabel: el.getAttribute('aria-label') || undefined,
    onChangeText: (v: string) => { el.value = v; ctx.fire(el, 'input', {inputType: 'insertText', data: v}) },
    onSubmitEditing: () => pressKey(el, 'Enter'),
    onFocus: () => el.focus(),
    onBlur: () => { if (el.ownerDocument.activeElement === el) { el.blur(); ctx.fire(el, 'change') } },
    style: s.all,
  })
  const switchC: NativeComponent = (el, _c, s, ctx) => h(Switch, {
    value: el.checked, disabled: el.disabled, accessibilityLabel: el.getAttribute('aria-label') || undefined,
    // a checkbox's click: it toggles, then input + change (undone when an intent prevents it)
    onValueChange: () => ctx.press(el),
    style: s.view,
  })
  const image: NativeComponent = (el, _c, s) => h(Image, {source: {uri: el.getAttribute('src') || (el as any).src}, accessibilityLabel: el.getAttribute('alt') || undefined, style: s.view, resizeMode: s.all.objectFit == 'contain' ? 'contain' : s.all.objectFit == 'fill' ? 'stretch' : 'cover'})
  const LAYOUT = /^(flexDirection|flexWrap|alignItems|justifyContent|alignContent|gap|rowGap|columnGap|padding\w*)$/
  const scroll = (el: HostElement, s: {view: NativeStyle}) => {
    const outer: NativeStyle = {}, inner: NativeStyle = {}
    for (const k in s.view) (LAYOUT.test(k) ? inner : outer)[k] = s.view[k]
    delete outer.overflow
    delete outer.display
    return {outer, inner, horizontal: inner.flexDirection == 'row', onScroll: (e: any) => {
      const {contentOffset: o = {}, contentSize: z = {}, layoutMeasurement: m = {}} = e?.nativeEvent || {}
      fireOn(el, 'scroll', {bubbles: false, detail: {x: o.x || 0, y: o.y || 0, end: (o.y || 0) + (m.height || 0) >= (z.height || 0) - 1}})
    }}
  }
  const scrollView: NativeComponent = (el, c, s) => {
    const {outer, inner, horizontal, onScroll} = scroll(el, s)
    return h(ScrollView, {style: outer, contentContainerStyle: inner, horizontal, onScroll, scrollEventThrottle: 50}, ...kids(c, s.text))
  }
  const list: NativeComponent = (el, _c, s, ctx) => {
    const {outer, inner, horizontal, onScroll} = scroll(el, s)
    return h(FlatList, {
      // each item is the memoized element of a host child; FlatList windows the native views
      data: el.children, keyExtractor: (n: HostElement) => String(nodeId(n)), renderItem: ({item}: {item: HostElement}) => ctx.child(item),
      extraData: el.revision, horizontal, style: outer, contentContainerStyle: inner, onScroll, scrollEventThrottle: 50,
    })
  }
  const select: NativeComponent = (el, _c, s, ctx) => {
    // no picker in React Native's core: a button that steps to the next option (input + change)
    const opts = el.options, i = Math.max(0, opts.findIndex(o => optionValue(o) == el.value))
    return h(Pressable, {accessibilityRole: 'button', accessibilityLabel: el.getAttribute('aria-label') || undefined, style: s.view,
      onPress: () => { const next = opts[(i + 1) % opts.length]; if (next) chooseOption(el, optionValue(next)) }},
      h(Text, {style: s.text}, (opts[i]?.textContent || '').trim() + ' ▾'))
    void ctx
  }
  return {
    View: view, Text: text, Pressable: pressable, TextInput: textInput, Switch: switchC, Image: image, ScrollView: scrollView, List: list,
    button: pressable, img: image, select,
    hr: (_el, _c, s) => h(View, {style: s.view}),
    br: () => h(Text, null, '\n'),
  }
}
const listensClick = (el: HostElement) => el.ownerDocument.listenedTypes(el).some(t => t == 'click')

/** the component for a host element: its primitive, its tag, its field kind, else View or Text */
function pick(el: HostElement, table: Record<string, NativeComponent>): NativeComponent {
  const p = prim(el)
  if (p && table[p]) return table[p]
  if (table[el.localName]) return table[el.localName]
  if (isCheckable(el)) return table.Switch
  if (isTextField(el)) return table.TextInput
  // a textual tag holding only text and inline text elements is Text; holding a field or a button,
  // it is a row of Views (a <label> around a checkbox)
  if (TEXTUAL.test(el.localName) && el.children.every(c => TEXTUAL.test(c.localName) && !prim(c) || c.localName == 'br')) return table.Text
  return table.View
}

export interface NativeHost {
  readonly doc: HostDocument
  /** the DOM driver: run(App, { DOM: host.driver }) */
  readonly driver: ReturnType<typeof makeHostDriver>
  /** the React component that shows the host tree */
  Root: () => any
  /** stop rendering (before the app's dispose empties the tree) */
  stop(): void
}

/** a host document, its driver, and the React component that renders it */
export function createNativeHost(options: NativeHostOptions = {}): NativeHost {
  const doc = new HostDocument()
  const table = {...defaultComponents(), ...options.components}
  const rules = [...(options.defaultStyles === false ? [] : defaultNativeStyles), ...(options.styles || [])]
  // each rule's style compiled once (StyleSheet validates it in development)
  const sheet: any = StyleSheet.create(Object.fromEntries(rules.map(([, st], i) => [i, Object.fromEntries(Object.entries(st).map(([k, v]) => [k, nativeValue(v)]))])))
  // a descendant / child selector (not a list's comma): an ancestor's class change can restyle below it
  const combinators = rules.some(([sel]) => sel.split(',').some(part => /[\s>]/.test(part.trim())))
  const incremental = options.incremental !== false
  const listeners = new Set<() => void>()
  let live = true
  doc.onChange = () => { if (live) for (const l of [...listeners]) l() }

  const ctx: NativeContext = {
    fire: fireOn,
    press: (el) => { activate(el, {onNavigate: options.onNavigate}) },
    child: (n) => (n.nodeType === 3 ? (n as any).data : h(Node, {key: nodeId(n), node: n, rev: n.revision, inh: 0})),
  }
  const styleOf = (el: HostElement) => {
    const parts: any[] = []
    for (let i = 0; i < rules.length; i++) if (matches(el, rules[i][0])) parts.push(sheet[i])
    const own = ownStyle(el)
    if (own) parts.push(own)
    const all: NativeStyle = parts.length ? {...StyleSheet.flatten(parts)} : {}
    if (el.hidden) all.display = 'none'
    delete all.overflow
    return split(all)
  }
  const render = (el: HostElement, inh: number): any => {
    options.onNodeRender?.(el)
    const c = pick(el, table)
    const childInh = combinators ? (inh * 31 + el.attrRevision + 1) | 0 : 0
    const children = el.childNodes.map((n) => n.nodeType === 3 ? (n as any).data
      : h(Node, {key: nodeId(n), node: n, rev: n.revision, inh: childInh}))
    // (inside Text, element children render as nested Text: an inline run)
    return c(el, children, styleOf(el), ctx)
  }
  const same = (a: any, b: any) => a.node === b.node && a.rev === b.rev && a.inh === b.inh
  const Node: any = incremental ? memo(({node, inh}: any) => render(node, inh), same) : ({node, inh}: any) => render(node, inh)

  function Root() {
    const [, force] = useReducer((x: number) => x + 1, 0)
    useEffect(() => { listeners.add(force); return () => { listeners.delete(force) } }, [])
    const body = doc.body
    return h(View, {style: options.style || {flex: 1}}, ...body.childNodes.map((n) =>
      n.nodeType === 3 ? h(Text, {key: nodeId(n)}, (n as any).data) : h(Node, {key: nodeId(n), node: n, rev: n.revision, inh: 0})))
  }
  return {doc, driver: makeHostDriver(doc), Root, stop: () => { live = false }}
}

export interface SygnalViewProps extends NativeHostOptions {
  /** the root component */
  app: any
  /** the app's other drivers (DOM is the bridge's) */
  drivers?: Record<string, any>
  /** run() options (onError, …) */
  runOptions?: Record<string, any>
}

/** a Sygnal app as a React Native component: runs it on mount, disposes it on unmount */
export function SygnalView(props: SygnalViewProps): any {
  const [host] = useState(() => createNativeHost(props))
  useEffect(() => {
    const app = run(props.app, {...props.drivers, DOM: host.driver}, props.runOptions)
    return () => { host.stop(); app.dispose() }
  }, [])
  return h(host.Root)
}
