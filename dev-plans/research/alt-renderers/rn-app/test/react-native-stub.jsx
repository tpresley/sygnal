// react-native, as react-dom host components: enough to run nativeHost.js in jsdom (the props
// nativeHost passes, the callbacks it relies on). Not React Native; the simulator run is the real test.
import React from 'react'
const flat = (style) => Object.assign({}, ...[style].flat(Infinity).filter(Boolean))
export const StyleSheet = { create: (o) => o }
export const View = ({ style, children }) => <div style={flat(style)}>{children}</div>
export const ScrollView = ({ contentContainerStyle, children }) => <div style={flat(contentContainerStyle)}>{children}</div>
export const Text = ({ style, children }) => <span style={flat(style)}>{children}</span>
export const Pressable = ({ onPress, accessibilityLabel, style, children }) =>
  <button aria-label={accessibilityLabel} style={flat(typeof style == 'function' ? style({ pressed: false }) : style)} onClick={onPress}>{children}</button>
export const TextInput = ({ value, placeholder, onChangeText, onSubmitEditing, onFocus }) =>
  <input value={value} placeholder={placeholder} onFocus={onFocus} onChange={(e) => onChangeText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && onSubmitEditing()} />
export const Switch = ({ value, onValueChange }) => <input type="checkbox" checked={value} onChange={(e) => onValueChange(e.target.checked)} />
export const SafeAreaView = View
