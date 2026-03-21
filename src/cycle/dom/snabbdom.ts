/**
 * Local snabbdom re-export barrel.
 *
 * Imports from specific snabbdom subpaths instead of the main barrel to avoid
 * triggering the broken `styleModule` top-level `window` reference in
 * snabbdom 3.6.3 (which causes ReferenceError in Node.js environments).
 *
 * The styleModule is provided separately by ./styleModule.ts with a fixed
 * window guard.
 */

// Core
export {h, fragment as HFragment} from 'snabbdom/build/h';
export {init} from 'snabbdom/build/init';
export type {Options} from 'snabbdom/build/init';
export {toVNode} from 'snabbdom/build/tovnode';
export {vnode} from 'snabbdom/build/vnode';
export type {VNode, VNodeData} from 'snabbdom/build/vnode';
import {Fragment as _Fragment} from 'snabbdom/build/jsx';

// Tag Fragment so we can identify it even after minification mangles Function.name
(_Fragment as any).__sygnalFragment = true;
export const Fragment = _Fragment;

// Module type
export type {Module} from 'snabbdom/build/modules/module';

// Modules (excluding styleModule — see ./styleModule.ts)
export {classModule} from 'snabbdom/build/modules/class';
export {propsModule} from 'snabbdom/build/modules/props';
export {attributesModule} from 'snabbdom/build/modules/attributes';
export {datasetModule} from 'snabbdom/build/modules/dataset';
