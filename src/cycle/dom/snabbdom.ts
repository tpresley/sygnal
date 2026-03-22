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
export {h, fragment as HFragment} from 'snabbdom/build/h.js';
export {init} from 'snabbdom/build/init.js';
export type {Options} from 'snabbdom/build/init.js';
export {toVNode} from 'snabbdom/build/tovnode.js';
export {vnode} from 'snabbdom/build/vnode.js';
export type {VNode, VNodeData} from 'snabbdom/build/vnode.js';
import {Fragment as _Fragment} from 'snabbdom/build/jsx.js';

// Tag Fragment so we can identify it even after minification mangles Function.name
(_Fragment as any).__sygnalFragment = true;
export const Fragment = _Fragment;

// Module type
export type {Module} from 'snabbdom/build/modules/module.js';

// Modules (excluding styleModule — see ./styleModule.ts)
export {classModule} from 'snabbdom/build/modules/class.js';
export {propsModule} from 'snabbdom/build/modules/props.js';
export {attributesModule} from 'snabbdom/build/modules/attributes.js';
export {datasetModule} from 'snabbdom/build/modules/dataset.js';
