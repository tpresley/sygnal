/**
 * EXPERIMENT (core rewrite study; extended in spike 0-S of PLAN-4.6): a component runtime with
 * the proposed structure (../03-proposal.md), to measure what the structure costs once the hard
 * features are in. NOT a drop-in core.
 *
 * Modules:
 *   runtime.ts   App: queue (run-to-completion), flush (one patch), loop guard, sink bus, hooks, run()
 *   define.ts    Def: normalized once per function; calculated (topological, SYG209); def hooks
 *   cell.ts      state cells: root, key, lens, local (isolatedState), calculated decorator, Collection items
 *   instance.ts  Inst: sources edge, actions, render (dirty-checked), reconcile, scope chain, dispose
 *   hosts.ts     Collection (filter, sort, item removal) and Switchable (hidden pages kept alive)
 *   statics.ts   generic __sygnalStatic declarations (timers, resources, connections, route)
 *   registry.ts  hosts / posts / pres / resolvers / defHooks
 *   markers.ts   Suspense + Lazy, registered on import (opt-in)
 *   uses.ts      behaviors (`uses`: undo, pager, selection) through a definition hook (opt-in)
 *
 * Supported: view, object intent, object/function model with STATE, PARENT, EFFECT, READY and driver
 * sinks (stamped; scoped through isolateValue or a per-sink stream fallback), reply actions,
 * initialState, isolatedState, calculated, function .context (read tracking), tag children with
 * a string / lens / no `state` prop, <Collection of from filter sort className>, <Switchable of
 * current state instance>, CHILD.select(Fn), STATE.stream / watch / select, dispose$, DOM
 * shorthand, BOOTSTRAP / INITIALIZE / DISPOSE, next(), onError (view).
 * Not: ELEMENT, commands$, props$/children$, slots, uid, EVENTS/LOG built-in drivers, G-146
 * input sequencing, Portal/Transition/ClientOnly, diagnostics, devtools, SSR, HMR.
 */
import './hosts'
export {run, App} from './runtime'
export type {Hooks} from './runtime'
