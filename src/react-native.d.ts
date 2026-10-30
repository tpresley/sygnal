// 'sygnal/react-native': a Sygnal app on React Native, on 'sygnal/host'. Needs react and
// react-native (optional peer dependencies). Guide: https://sygnal.js.org/renderers/react-native
import type { HostDocument, HostElement, HostNode, HostSource } from 'sygnal/host'

export type NativeStyle = Record<string, any>
export type NativeStyleRule = [selector: string, style: NativeStyle]
/** HTML defaults for native: headings, links, buttons, fields */
export const defaultNativeStyles: NativeStyleRule[]

export interface NativeContext {
  fire(el: HostElement, type: string, init?: Record<string, any>): boolean
  /** a click and its default action */
  press(el: HostElement): void
  /** a host child as a (memoized) React element */
  child(node: HostNode): any
}
/** a component of the table: the element, its children, its style (view keys, text keys, all) */
export type NativeComponent = (el: HostElement, children: any[], style: { view: NativeStyle, text: NativeStyle, all: NativeStyle }, ctx: NativeContext) => any

export interface NativeHostOptions {
  /** the app's native stylesheet (after defaultNativeStyles) */
  styles?: readonly NativeStyleRule[]
  /** false: no defaultNativeStyles */
  defaultStyles?: boolean
  /** replace or add components, by primitive name ('View', 'List') or tag ('button', 'my-chart') */
  components?: Record<string, NativeComponent>
  /** a link's default action (a router driver's go) */
  onNavigate?: (href: string, el: HostElement) => void
  /** false: re-render every element on every change (for measuring) */
  incremental?: boolean
  /** called each time an element's React component renders */
  onNodeRender?: (el: HostElement) => void
  /** the root View's style (default { flex: 1 }) */
  style?: NativeStyle
}

export interface NativeHost {
  readonly doc: HostDocument
  /** run(App, { DOM: host.driver }) */
  readonly driver: (vnode$: any, name?: string) => HostSource
  /** the React component that shows the host tree */
  Root: () => any
  /** stop rendering (before the app's dispose) */
  stop(): void
}
export function createNativeHost(options?: NativeHostOptions): NativeHost

export interface SygnalViewProps extends NativeHostOptions {
  /** the root component */
  app: any
  /** the app's other drivers */
  drivers?: Record<string, any>
  /** run() options */
  runOptions?: Record<string, any>
}
/** a Sygnal app as a React Native component */
export function SygnalView(props: SygnalViewProps): any
