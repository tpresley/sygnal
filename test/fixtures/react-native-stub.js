// react-native, as react-dom host components: enough to run sygnal/react-native in jsdom (the
// props the bridge passes, the callbacks it relies on). Not React Native: the iOS simulator run
// (examples/write-once) is the real check.
import { createElement as h } from 'react'

const flat = (style) => Object.assign({}, ...[style].flat(Infinity).filter(Boolean))
const css = (style) => {
  const out = {}
  for (const [k, v] of Object.entries(flat(style))) out[k] = v
  return out
}
export const StyleSheet = { create: (o) => o, flatten: (s) => flat(s) }
export const View = ({ style, children }) => h('div', { 'data-rn': 'View', style: css(style) }, children)
export const Text = ({ style, children, onPress, accessibilityRole }) => h('span', { 'data-rn': 'Text', style: css(style), onClick: onPress, role: accessibilityRole }, children)
export const Pressable = ({ onPress, accessibilityLabel, style, disabled, children }) =>
  h('button', { 'data-rn': 'Pressable', 'aria-label': accessibilityLabel, disabled, style: css(typeof style == 'function' ? style({ pressed: false }) : style), onClick: onPress }, children)
export const TextInput = ({ value, placeholder, onChangeText, onSubmitEditing, onFocus, onBlur, multiline, secureTextEntry, style }) =>
  h(multiline ? 'textarea' : 'input', { 'data-rn': 'TextInput', value, placeholder, type: secureTextEntry ? 'password' : undefined, style: css(style), onFocus, onBlur, onChange: (e) => onChangeText(e.target.value), onKeyDown: (e) => e.key === 'Enter' && onSubmitEditing?.() })
export const Switch = ({ value, onValueChange, disabled }) => h('input', { 'data-rn': 'Switch', type: 'checkbox', checked: value, disabled, onChange: (e) => onValueChange(e.target.checked) })
export const Image = ({ source, accessibilityLabel, style }) => h('img', { 'data-rn': 'Image', src: source?.uri, alt: accessibilityLabel, style: css(style) })
export const ScrollView = ({ style, contentContainerStyle, children, onScroll }) => h('div', { 'data-rn': 'ScrollView', style: css(style), onScroll }, h('div', { style: css(contentContainerStyle) }, children))
export const FlatList = ({ data, renderItem, keyExtractor, style }) => h('div', { 'data-rn': 'FlatList', style: css(style) }, data.map((item, index) => h('div', { key: keyExtractor(item, index) }, renderItem({ item, index }))))
