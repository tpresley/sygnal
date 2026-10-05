/**
 * Extension registries (spike 0-S, ../03-proposal.md §2 markers.ts + §6 hooks).
 *
 * The core never names Suspense, Lazy, behaviors, Portal, ...: a module registers what it needs
 * when it is imported, and an app that never imports it pays nothing.
 *
 * - hosts:     vnode sel -> a factory for a child "host" that renders in place of the marker
 *              (Collection, Switchable). A host has render(), setProps(), dispose(), ready, last.
 * - posts:     vnode sel -> a post-processor run on an instance's injected vnode when its template
 *              contained that marker (Suspense).
 * - pres:      vnode sel -> a template rewrite run during the reconcile walk (Portal, Transition,
 *              ClientOnly would go here: they replace their marker with a plain vnode and keep
 *              walking its children). Unused in the spike.
 * - resolvers: component view -> the view to instantiate (Lazy: the loaded component once its
 *              import resolved).
 * - defHooks:  definition time: (src, view) -> src. Behaviors (`uses`), undo, persist edit the
 *              definition once per component function, never an instance.
 */
export const hosts: Record<string, (owner: any, props: any, children: any) => any> = {}
export const posts: Record<string, (vnode: any) => any> = {}
export const pres: Record<string, (vnode: any, inst: any) => any> = {}
export const resolvers: Array<(view: any, inst: any) => any> = []
export const defHooks: Array<(src: DefSource, view: any) => DefSource | void> = []

/** what a definition hook may edit (the component's statics, normalized afterwards) */
export interface DefSource {
  model: any
  intent: any
  initialState: any
  /** default values of missing keys (a behavior's slice on a sub-component host) */
  idle: any
  calculated: any
  context: any
}
