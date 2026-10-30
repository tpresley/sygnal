/*
 * 'sygnal/primitives': View, Text, Pressable, TextInput, Switch, Image, ScrollView, List. Neutral
 * components for an app that runs on the web, on React Native ('sygnal/react-native'), in a
 * terminal and for an agent ('sygnal/terminal', 'sygnal/agent-ui'). Each renders a sensible HTML
 * element (a View is a flex-column <div>, a Pressable a <button>, a Switch an
 * <input type="checkbox" role="switch">), so the web and the text targets need nothing more; the
 * element carries `data-primitive="View"` so the native bridge picks the matching React Native
 * component.
 *
 *   const { Add, Draft } = controls({ Add: Pressable, Draft: TextInput })   // selectable: intents
 *   <View style={{ padding: 16, gap: 8 }}><Draft value={state.draft} /><Add>Add</Add></View>
 *
 * Styles are React Native's style objects (camelCase, numbers for lengths): a number becomes
 * `px` for the web (except unitless keys: flex, opacity, fontWeight, …), and the native bridge
 * reads `px` back as a number. A primitive is a JSX tag and a controls() spec (`kind`, `vnode`),
 * not a component: it renders where it's written, in its parent's scope.
 *
 * No dependency: no React, no React Native, nothing from the core but the JSX pragma it's given.
 */

const UNITLESS = /^(flex|flexGrow|flexShrink|opacity|zIndex|fontWeight|aspectRatio|elevation|lineClamp|order)$/

/** a React Native style (an object, or nested arrays with falsy holes) as a web style object */
export function webStyle(style: any): Record<string, any> | undefined {
  if (!style) return undefined
  if (Array.isArray(style)) return style.reduce((out, s) => Object.assign(out, webStyle(s)), {})
  const out: Record<string, any> = {}
  for (const k in style) {
    const v = style[k]
    if (v == null || v === false) continue
    const css = typeof v == 'number' && !UNITLESS.test(k) ? v + 'px' : v
    // React Native's shorthands that CSS doesn't have
    const m = /^(padding|margin)(Horizontal|Vertical|Start|End)$/.exec(k)
    if (m) {
      const sides = m[2] == 'Horizontal' ? ['Left', 'Right'] : m[2] == 'Vertical' ? ['Top', 'Bottom'] : [m[2] == 'Start' ? 'InlineStart' : 'InlineEnd']
      for (const side of sides) out[m[1] + side] = css
    } else if (k != 'elevation' && !/^shadow(Color|Offset|Opacity|Radius)$/.test(k)) out[k] = css
  }
  return out
}

type Props = Record<string, any>
type Primitive = ((props: Props) => any) & {
  __sygnalControl: (data: Props | null, children: any[], h: any) => any
  kind: string
  vnode: (props: Props, children: any[], h: any) => any
  componentName: string
}

// React Native prop names that have an HTML counterpart
function common(p: Props, name: string, base?: Props): Props {
  const {style, accessibilityLabel, accessibilityRole, testID, nativeID, ...rest} = p
  const out: Props = {...rest, 'data-primitive': name}
  const s = base || style ? {...base, ...webStyle(style)} : undefined
  if (s) out.style = s
  if (accessibilityLabel != null && out['aria-label'] == null) out['aria-label'] = accessibilityLabel
  if (accessibilityRole != null && out.role == null) out.role = accessibilityRole
  if (testID != null) out['data-testid'] = testID
  if (nativeID != null && out.id == null) out.id = nativeID
  return out
}

// React Native's box defaults on the web: no border unless one is styled (a borderWidth alone
// shows a solid border), border-box sizing, items that don't shrink below their content
const BOX = {boxSizing: 'border-box', borderWidth: 0, borderStyle: 'solid', position: 'relative', minWidth: 0, flexShrink: 0}
// a Pressable starts as a plain box (no browser button look), inheriting the text font and color
const PLAIN = {...BOX, display: 'flex', flexDirection: 'column', background: 'none', padding: 0, margin: 0, font: 'inherit', color: 'inherit', textAlign: 'inherit', cursor: 'pointer'}

function primitive(name: string, render: (p: Props, children: any[], h: any) => any): Primitive {
  const vnode = (p: Props, children: any[], h: any) => render(p || {}, children, h)
  // a JSX tag outside controls(): the pragma calls __sygnalControl (it renders an element here)
  const prim: any = () => { throw new Error(`${name} from 'sygnal/primitives' is a JSX tag, not a function to call`) }
  prim.__sygnalControl = (data: Props | null, children: any[], h: any) => vnode(data || {}, children, h)
  prim.kind = name
  prim.vnode = vnode
  prim.componentName = name
  return prim
}

/** a flex container (column by default, as React Native's) */
export const View = primitive('View', (p, c, h) =>
  h('div', common(p, 'View', {...BOX, display: 'flex', flexDirection: 'column'}), ...c))

/** text (nest Text in Text for inline runs) */
export const Text = primitive('Text', (p, c, h) => {
  const {numberOfLines, selectable, ...rest} = p
  return h('span', common(rest, 'Text', numberOfLines ? {display: '-webkit-box', WebkitLineClamp: numberOfLines, WebkitBoxOrient: 'vertical', overflow: 'hidden'} : undefined), ...c)
})

/** a pressable area: a <button type="button">; intents listen for `click` */
export const Pressable = primitive('Pressable', (p, c, h) => {
  const {disabled, ...rest} = p
  return h('button', {...common(rest, 'Pressable', PLAIN), type: 'button', ...(disabled ? {disabled: true} : {})}, ...c)
})

/** a text field: an <input> (a <textarea> when multiline); intents listen for `input`, `keydown`, `change` */
export const TextInput = primitive('TextInput', (p, c, h) => {
  const {multiline, secureTextEntry, editable, keyboardType, onChangeText, defaultValue, ...rest} = p
  const out = common(rest, 'TextInput', BOX)
  if (secureTextEntry) out.type = 'password'
  else if (keyboardType == 'email-address') out.type = 'email'
  else if (keyboardType == 'numeric' || keyboardType == 'number-pad' || keyboardType == 'decimal-pad') out.inputMode = keyboardType == 'decimal-pad' ? 'decimal' : 'numeric'
  if (editable === false) out.readOnly = true
  if (out.value == null && defaultValue != null) out.value = defaultValue
  return multiline ? h('textarea', out, ...c) : h('input', out)
})

/** an on/off switch: <input type="checkbox" role="switch">; `value` (React Native's name) or `checked` */
export const Switch = primitive('Switch', (p, _c, h) => {
  const {value, checked, disabled, ...rest} = p
  return h('input', {...common(rest, 'Switch'), type: 'checkbox', role: 'switch', checked: !!(checked ?? value), ...(disabled ? {disabled: true} : {})})
})

/** an image: `source={{ uri }}` (React Native's) or `src`; give it a width and height */
export const Image = primitive('Image', (p, _c, h) => {
  const {source, src, alt, resizeMode, ...rest} = p
  const out = common(rest, 'Image', resizeMode ? {objectFit: resizeMode == 'stretch' ? 'fill' : resizeMode == 'repeat' ? 'none' : resizeMode} : undefined)
  out.src = src ?? (typeof source == 'object' && source ? source.uri : source)
  out.alt = alt ?? out['aria-label'] ?? ''
  return h('img', out)
})

/** a scrolling container (`horizontal` for a row); intents can listen for `scroll` */
export const ScrollView = primitive('ScrollView', (p, c, h) => {
  const {horizontal, contentContainerStyle, ...rest} = p
  return h('div', common(rest, 'ScrollView', {...BOX, display: 'flex', flexDirection: horizontal ? 'row' : 'column', overflow: 'auto', ...webStyle(contentContainerStyle)}), ...c)
})

/**
 * A long list: put a <Collection> in it. On the web, a scrolling column; on React Native, a
 * FlatList over its children (native views are windowed; the Sygnal items all stay mounted).
 */
export const List = primitive('List', (p, c, h) => {
  const {horizontal, ...rest} = p
  return h('div', {role: 'list', ...common(rest, 'List', {...BOX, display: 'flex', flexDirection: horizontal ? 'row' : 'column', overflow: 'auto'})}, ...c)
})
