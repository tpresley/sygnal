// Build-time declarations for the optional peer dependencies of the 'sygnal/react' entry, so the
// build doesn't need @types/react. The entry's public types are in react.d.ts.
declare module 'react' { export const createElement: (type: any, props?: any, ...children: any[]) => any }
declare module 'react-dom' { export const flushSync: <R>(fn: () => R) => R }
declare module 'react-dom/client' { export const createRoot: (el: Element) => { render(node: any): void; unmount(): void } }
