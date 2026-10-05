/**
 * PLAN-4.6 core: the module registries (04-hooks-contract §2.1). A feature module fills them
 * when it is imported; the core only looks them up, so an app that never imports the module pays
 * nothing (D157). R2 fills hosts (core/hosts: Collection, Switchable) and the markers
 * (core/markers: Portal, Transition, ClientOnly, Suspense, lazy), each imported by its public
 * module; R3 adds the definition hooks (behaviors, undo, selection, pager, persist, resources).
 *
 * The entries are core modules: they get the owner's raw instance (hooks get InstanceViews).
 */
import type {ComponentFn, DefSource} from './hooks'

/**
 * marker sel -> a child that renders in place of the marker (Collection, Switchable): render(),
 * setProps(props, children, marker, id), dispose(), ready, outv / last, insts() (its instances)
 */
export const hosts: Record<string, (owner: any, props: Record<string, any>, children: any[], id: string, marker: any) => any> = {}
/** marker sel -> a template rewrite during the reconcile walk (Portal, Transition, ClientOnly, Slot) */
export const pres: Record<string, (vnode: any, owner: any) => any> = {}
/** marker sel -> a post-processor of an instance's injected vnode whose template had it (Suspense) */
export const posts: Record<string, (vnode: any, owner: any) => any> = {}
/** component function -> the function to instantiate (lazy: the loaded component once resolved) */
export const resolvers: Array<(view: ComponentFn, owner: any) => ComponentFn | undefined> = []
/** definition time, every app: (src, view) -> src (behaviors, undo, selection, pager, persist, resources) */
export const defHooks: Array<(src: DefSource, view: ComponentFn) => DefSource | void> = []
