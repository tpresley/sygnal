/**
 * Sygnal → React Native. A Sygnal app renders into a sygnal/host tree (the same kit as the
 * terminal and agent UI targets); each change re-renders that tree as React Native host
 * components. React Native owns the native views; the host tree owns selectors, isolation and
 * refs. Native callbacks become the DOM events intents listen for (D-AR-3), through sygnal/host's
 * user-agent actions, so the intents are the web's.
 *
 * Tags: the neutral vocabulary (view, row, txt, pressable, textinput, toggle) and the common HTML
 * tags map to the same components, so an HTML view (the counter's) runs natively unchanged.
 */
import React from 'react'
import { View, Text, Pressable, TextInput, Switch, ScrollView, StyleSheet } from 'react-native'
import { HostDocument, HostEvent, makeHostDriver, registerFieldTags, activate, pressKey, nodeId } from 'sygnal/host'

registerFieldTags('textinput', 'toggle')

const s = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  button: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8, backgroundColor: '#2f6fed' },
  buttonText: { color: 'white', fontSize: 17, fontWeight: '600' },
  input: { borderWidth: 1, borderColor: '#bbb', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, fontSize: 17, minWidth: 180 },
  h1: { fontSize: 28, fontWeight: '700', marginBottom: 8 },
})

const fire = (el, type, init) => el.dispatchEvent(new HostEvent(type, init))
const styleOf = (el) => (el.style && Object.keys(el.style).length ? el.style : undefined)

/** tag → (element, children) → a React element */
const TABLE = {
  view: (el, kids) => <View style={styleOf(el)}>{kids}</View>,
  row: (el, kids) => <View style={[s.row, styleOf(el)]}>{kids}</View>,
  txt: (el, kids) => <Text style={styleOf(el)}>{kids}</Text>,
  pressable: (el, kids) => (
    <Pressable accessibilityRole="button" accessibilityLabel={el.getAttribute('aria-label') || undefined}
      onPress={() => activate(el)} style={({ pressed }) => [s.button, pressed && { opacity: 0.6 }, styleOf(el)]}>
      <Text style={s.buttonText}>{kids}</Text>
    </Pressable>
  ),
  textinput: (el) => (
    <TextInput style={[s.input, styleOf(el)]} value={el.value} placeholder={el.placeholder || undefined}
      onFocus={() => el.focus()}
      onChangeText={(v) => { el.value = v; fire(el, 'input') }}
      onSubmitEditing={() => pressKey(el, 'Enter')} />
  ),
  // a toggle isn't an <input type=checkbox> to activate(): it gets a checkbox's events itself
  toggle: (el) => <Switch value={el.checked} onValueChange={(v) => { el.checked = v; fire(el, 'click'); fire(el, 'input'); fire(el, 'change') }} />,
}
// HTML tags, for views written for the web
Object.assign(TABLE, {
  div: TABLE.view, section: TABLE.view, main: TABLE.view, header: TABLE.view, footer: TABLE.view, ul: TABLE.view, li: TABLE.row, form: TABLE.view,
  span: TABLE.txt, p: TABLE.txt, label: TABLE.txt, strong: TABLE.txt,
  h1: (el, kids) => <Text style={[s.h1, styleOf(el)]}>{kids}</Text>,
  button: TABLE.pressable,
  input: (el, kids) => (el.type === 'checkbox' ? TABLE.toggle(el, kids) : TABLE.textinput(el, kids)),
})
const TEXTUAL = new Set(['txt', 'span', 'p', 'label', 'strong', 'h1', 'pressable', 'button'])

/** the host tree as React Native elements (a string outside a Text is wrapped in one) */
export function toNative(node, inText = false) {
  if (node.nodeType === 3) return inText ? node.data : <Text key={nodeId(node)}>{node.data}</Text>
  if (node.hidden) return null
  const tag = node.localName
  const textual = TEXTUAL.has(tag)
  const kids = node.childNodes.map((c) => toNative(c, textual))
  const make = TABLE[tag] || TABLE.view
  return React.cloneElement(make(node, kids), { key: nodeId(node) })
}

/** a Sygnal DOM driver whose screen is a React Native tree; `render` gets each new tree */
export function createNativeHost(render) {
  const doc = new HostDocument()
  const paint = () => render(<ScrollView contentContainerStyle={{ padding: 24, gap: 12 }}>{doc.body.childNodes.map((c) => toNative(c))}</ScrollView>)
  let live = true
  doc.onChange = () => live && paint()
  return {
    doc,
    driver: makeHostDriver(doc, { onPatch: () => live && paint() }),
    /** stop painting (before the app's dispose, which empties the tree) */
    stop: () => { live = false },
  }
}
