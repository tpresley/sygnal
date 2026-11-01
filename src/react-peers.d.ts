// Build-time declarations for the optional peer dependencies of the 'sygnal/react' and
// 'sygnal/react-native' entries, so the build doesn't need @types/react or React Native's types.
// The entries' public types are in react.d.ts and react-native.d.ts.
declare module 'react' {
  export const createElement: (type: any, props?: any, ...children: any[]) => any
  export const memo: <F>(component: F, equal?: (a: any, b: any) => boolean) => F
  export const useState: <T>(init: T | (() => T)) => [T, (v: T | ((p: T) => T)) => void]
  export const useReducer: (reducer: (s: number) => number, init: number) => [number, () => void]
  export const useEffect: (effect: () => void | (() => void), deps?: any[]) => void
}
declare module 'react-native' {
  export const View: any
  export const Text: any
  export const Pressable: any
  export const TextInput: any
  export const Switch: any
  export const Image: any
  export const ScrollView: any
  export const FlatList: any
  export const StyleSheet: {create<T>(styles: T): T, flatten(style: any): Record<string, any>}
}
declare module 'react-dom' { export const flushSync: <R>(fn: () => R) => R }
declare module 'react-dom/client' { export const createRoot: (el: Element) => { render(node: any): void; unmount(): void } }
