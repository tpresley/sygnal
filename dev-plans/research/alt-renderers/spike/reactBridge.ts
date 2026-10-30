/**
 * A React host bridge (experiment C): Sygnal patches a HostDocument (as for the terminal), and each
 * commit renders that host tree as React elements of a platform's host components. React (React
 * DOM here; React Native's renderer on a device) owns the native views; the host tree stays the
 * source of truth for selectors, isolation and refs. Native callbacks (onClick / onPress /
 * onChangeText) dispatch the DOM-shaped HostEvents intents listen for, on the host element.
 *
 * Tested with react-dom (installed); `nativeTable` shows the React Native mapping (not run here:
 * no react-native in this repo, see README §2).
 */
import {createElement as h, Fragment} from 'react'
import {HostDocument, HostElement, HostEvent, HostNode, HostText} from './host'
import {makeHostDriver} from './hostDriver'

export type Fire = (type: string, init?: Record<string, any>) => void
export type HostTable = Record<string, (el: HostElement, fire: Fire) => [type: any, props: Record<string, any>]>

let ids = 0
const keyOf = new WeakMap<HostNode, number>()
const key = (n: HostNode) => keyOf.get(n) ?? (keyOf.set(n, ++ids), ids)

export function toReact(n: HostNode, table: HostTable, wrapText?: (s: string, key: number) => any): any {
  if (n instanceof HostText) return wrapText ? wrapText(n.data, key(n)) : n.data
  const el = n as HostElement
  const fire: Fire = (type, init) => el.dispatchEvent(new HostEvent(type, init))
  const row = table[el.localName]
  const [type, props] = row ? row(el, fire) : [Fragment, {}]
  const textual = el.localName == 'txt' || el.localName == 'pressable'
  const kids = el.childNodes.map((c) => toReact(c, table, textual ? undefined : wrapText))
  const p: any = {...props, key: key(el)}
  if (type !== Fragment && el.className) p.className = el.className
  return kids.length ? h(type, p, ...kids) : h(type, p)
}

/** react-dom's host components, with the DOM's own events */
export const domTable: HostTable = {
  root: () => [Fragment, {}],
  view: () => ['div', {}],
  row: () => ['div', {style: {display: 'flex', gap: '0.5em'}}],
  txt: () => ['span', {}],
  pressable: (el, fire) => ['button', {type: 'button', 'data-control': el.dataset.control || el.getAttribute('data-control'), 'aria-label': el.getAttribute('aria-label') ?? undefined, onClick: () => fire('click')}],
  textinput: (el, fire) => ['input', {
    value: el.value, placeholder: el.placeholder || undefined, 'data-control': el.getAttribute('data-control'),
    onChange: (e: any) => { el.value = e.target.value; fire('input') },
    onKeyDown: (e: any) => fire('keydown', {key: e.key, keyCode: e.keyCode}),
  }],
  toggle: (el, fire) => ['input', {
    type: 'checkbox', checked: el.checked, 'data-control': el.getAttribute('data-control'),
    onChange: (e: any) => { el.checked = e.target.checked; fire('click'); fire('change') },
  }],
}

/**
 * React Native's (illustrative, unverified): the same events from native callbacks. RN needs
 * every string inside <Text>, hence wrapText for text outside txt / pressable.
 */
export const nativeTable = (RN: any): {table: HostTable, wrapText: (s: string, k: number) => any} => ({
  table: {
    root: () => [RN.View, {style: {flex: 1}}],
    view: () => [RN.View, {}],
    row: () => [RN.View, {style: {flexDirection: 'row', gap: 8}}],
    txt: () => [RN.Text, {}],
    pressable: (el, fire) => [RN.Pressable, {accessibilityRole: 'button', accessibilityLabel: el.getAttribute('aria-label'), onPress: () => fire('click')}],
    textinput: (el, fire) => [RN.TextInput, {
      value: el.value, placeholder: el.placeholder,
      onChangeText: (v: string) => { el.value = v; fire('input') },
      onSubmitEditing: () => fire('keydown', {key: 'Enter', keyCode: 13}),
    }],
    toggle: (el, fire) => [RN.Switch, {value: el.checked, onValueChange: (v: boolean) => { el.checked = v; fire('click'); fire('change') }}],
  },
  wrapText: (s, k) => h(RN.Text, {key: k}, s),
})

/** a Sygnal DOM driver whose output is React elements, handed to `render` after each change */
export function createReactHost(table: HostTable, render: (el: any) => void, wrapText?: (s: string, k: number) => any) {
  const doc = new HostDocument()
  const paint = () => render(toReact(doc.body, table, wrapText))
  doc.onChange = paint
  const driver = makeHostDriver(doc, {onPatch: paint})
  return {doc, driver}
}
