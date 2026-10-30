// 'sygnal/primitives': neutral components for web, React Native, terminal and agent UI.
// Guide: https://sygnal.js.org/renderers/write-once
/** A React Native style object (numbers are lengths: px on the web), or arrays of them */
export type PrimitiveStyle = Record<string, any> | null | undefined | false | readonly PrimitiveStyle[]

interface Common {
  style?: PrimitiveStyle
  className?: string
  id?: string
  key?: string | number
  accessibilityLabel?: string
  accessibilityRole?: string
  testID?: string
  nativeID?: string
  'aria-label'?: string
  children?: any
  [prop: string]: any
}

/** A primitive: a JSX tag, and a controls() spec (`controls({ Add: Pressable })`) */
export interface Primitive<P> {
  (props: P): any
  readonly kind: string
  vnode(props: P, children: any[], h: any): any
}

/** a flex container (a flex-column <div> on the web) */
export const View: Primitive<Common>
/** text (a <span>) */
export const Text: Primitive<Common & { numberOfLines?: number, selectable?: boolean }>
/** a pressable area (a <button type="button">): intents listen for click */
export const Pressable: Primitive<Common & { disabled?: boolean }>
/** a text field (an <input>, or a <textarea> when multiline): input, keydown, change */
export const TextInput: Primitive<Common & {
  value?: string
  defaultValue?: string
  placeholder?: string
  multiline?: boolean
  secureTextEntry?: boolean
  editable?: boolean
  keyboardType?: 'default' | 'email-address' | 'numeric' | 'number-pad' | 'decimal-pad'
  name?: string
}>
/** an on/off switch (<input type="checkbox" role="switch">): click, input, change */
export const Switch: Primitive<Common & { value?: boolean, checked?: boolean, disabled?: boolean }>
/** an image (an <img>); give it a width and height */
export const Image: Primitive<Common & { source?: { uri: string } | string, src?: string, alt?: string, resizeMode?: 'cover' | 'contain' | 'stretch' | 'repeat' | 'center' }>
/** a scrolling container: scroll */
export const ScrollView: Primitive<Common & { horizontal?: boolean, contentContainerStyle?: PrimitiveStyle }>
/** a long list (a FlatList on React Native): put a <Collection> in it */
export const List: Primitive<Common & { horizontal?: boolean }>

/** a React Native style as a web style object (numbers → px, except unitless keys) */
export function webStyle(style: PrimitiveStyle): Record<string, any> | undefined
