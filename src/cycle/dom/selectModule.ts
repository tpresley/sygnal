/**
 * Snabbdom module that applies a <select>'s `value` after its <option>s exist.
 *
 * Problem: snabbdom runs the module create/update hooks (propsModule sets
 * elm.value) BEFORE it creates or patches the element's children. When the
 * matching <option> is new in this patch, the browser ignores the value and
 * the <select> shows the first option. On create that is every <select>; on
 * update it is a value change together with an options change (B-017).
 *
 * Fix: collect <select> elements with a value prop during create and update,
 * then re-apply the value in the post hook, after all children are patched.
 */

import type {VNode} from 'snabbdom/build/vnode.js';

let pendingSelects: Array<{elm: HTMLSelectElement; value: any}> = [];

function queueSelect(_oldVnode: VNode, vnode: VNode): void {
  const elm = vnode.elm as Element;
  const value = vnode.data?.props?.value;
  if (elm && elm.tagName === 'SELECT' && value != null) {
    pendingSelects.push({elm: elm as HTMLSelectElement, value});
  }
}

function postPatch(): void {
  const list = pendingSelects;
  pendingSelects = [];
  for (let i = 0; i < list.length; i++) {
    const {elm, value} = list[i];
    if (elm.value !== String(value)) elm.value = value;
  }
}

export const selectModule = {create: queueSelect, update: queueSelect, post: postPatch};
