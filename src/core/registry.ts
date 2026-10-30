/**
 * PLAN-4.6 core: the module registries (04-hooks-contract §2.1). A feature fills them when it is
 * used; the core only looks them up, so an app that never uses the feature pays nothing (D157).
 * R2 fills hosts (core/hosts: Collection, Switchable) and the markers (core/markers: Portal,
 * Transition, ClientOnly, Suspense, lazy). G-751: Portal, Transition and Suspense register their
 * handler when a tag uses them (the pragma calls the marker's `$reg`) and `lazy()` its resolver,
 * not on import: a module-level registration is kept by every bundle of the single-file build.
 * Collection and Switchable register on import (the lowercase `<collection>` / `<switchable>`
 * work without one); ClientOnly's is in runtime.ts (sygnal/vike can't reach the registry). R3
 * adds the definition hooks (behaviors, undo, selection, pager, persist, resources).
 *
 * The entries are core modules: they get the owner's raw instance (hooks get InstanceViews).
 */
import type {ComponentFn, DefSource} from './hooks'

/**
 * marker sel -> a child that renders in place of the marker (Collection, Switchable): render(),
 * setProps(props, children, marker, id), dispose(), ready, outv / last, insts() (its instances)
 */
export const hosts: Record<string, (owner: any, props: Record<string, any>, children: any[], id: string, marker: any) => any> = {}
/** marker sel -> a template rewrite during the reconcile walk (Portal, Transition, ClientOnly, Slot,
 * widget); `path` is the marker's place in the owner's template ('r.0.2': a widget's identity) */
export const pres: Record<string, (vnode: any, owner: any, path: string) => any> = {}
/** marker sel -> a post-processor of an instance's injected vnode whose template had it (Suspense) */
export const posts: Record<string, (vnode: any, owner: any) => any> = {}
/** component function -> the function to instantiate (lazy: the loaded component once resolved) */
export const resolvers: Array<(view: ComponentFn, owner: any) => ComponentFn | undefined> = []
/** definition time, every app: (src, view) -> src (behaviors, undo, selection, pager, persist, resources) */
export const defHooks: Array<(src: DefSource, view: ComponentFn) => DefSource | void> = []
/** CV-3 (compiled blocks, src/pragma/blocks.ts, registered by the first block): xb expands blocks
 * into plain vnodes for a DOM driver that doesn't patch them (not `DOMDriver.blocks`); sb, the
 * same-output check for two blocks */
export const ext: {xb?: (v: any) => any; sb?: (a: any, b: any) => boolean} = {}
