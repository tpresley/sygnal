/**
 * Snabbdom module that keeps controlled form fields in sync with the vnode (B-004).
 *
 * Problem: snabbdom's propsModule only writes `value`/`checked` when the prop
 * differs from the previous vnode's prop. If the user types 'x' and an action
 * resets the state to '' within one render window, the 'x' render is
 * coalesced away: the vnodes go '' -> '' and the typed text stays in the DOM.
 *
 * Fix: after propsModule has run, compare `value`/`checked` props against the
 * live element and write them when they differ.
 */

import type {VNode} from 'snabbdom/build/vnode.js';

function syncControlled(oldVnode: VNode, vnode: VNode): void {
  const props = vnode.data?.props;
  const elm = vnode.elm as any;
  if (!props || !elm) return;
  const oldProps: any = oldVnode.data?.props || {};
  // Only the case propsModule skipped (prop unchanged); it handles real changes.
  if ('value' in props && props.value === oldProps.value && props.value != null && elm.value !== String(props.value)) {
    elm.value = props.value;
  }
  if ('checked' in props && props.checked === oldProps.checked && props.checked != null && elm.checked !== !!props.checked) {
    elm.checked = props.checked;
  }
}

export const controlledInputModule = {update: syncControlled};
