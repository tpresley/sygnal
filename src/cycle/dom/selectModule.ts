/**
 * Snabbdom module that fixes <select> value assignment.
 *
 * Problem: snabbdom's createElm() fires the propsModule create hook
 * (which sets elm.value) BEFORE appending child <option> elements.
 * The browser silently ignores the value assignment because no matching
 * option exists yet, so <select> always shows the first option.
 *
 * Fix: collect <select> elements that have a value prop during create,
 * then re-apply the value in the post hook (after all elements and
 * children have been inserted).
 */

import type {VNode} from 'snabbdom/build/vnode.js';

let pendingSelects: Array<{elm: HTMLSelectElement; value: any}> = [];

function createSelect(_oldVnode: VNode, vnode: VNode): void {
  const elm = vnode.elm as Element;
  if (elm && elm.tagName === 'SELECT' && vnode.data?.props?.value !== undefined) {
    pendingSelects.push({elm: elm as HTMLSelectElement, value: vnode.data.props.value});
  }
}

function postPatch(): void {
  for (let i = 0; i < pendingSelects.length; i++) {
    const {elm, value} = pendingSelects[i];
    elm.value = value;
  }
  pendingSelects = [];
}

export const selectModule = {create: createSelect, post: postPatch};
