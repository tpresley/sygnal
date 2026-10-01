/**
 * Snabbdom module that keeps controlled form fields in sync with the vnode (B-004).
 *
 * Problem: snabbdom's propsModule only writes `value`/`checked` when the prop
 * differs from the previous vnode's prop. If the user types 'x' and an action
 * resets the state to '' within one render window, the 'x' render is
 * coalesced away: the vnodes go '' -> '' and the typed text stays in the DOM.
 *
 * Fix: after propsModule has run, compare `value`/`checked` props against the
 * live element and write them when they differ. Only form fields (INPUT,
 * TEXTAREA, SELECT; not input type=file) are controlled: `value` compares as a
 * string, `checked` as a boolean (1H-7). Other elements with a value prop
 * (<progress>, <meter>, custom elements with object values) are left alone.
 */

import type {VNode} from 'snabbdom/build/vnode.js';

function syncControlled(oldVnode: VNode, vnode: VNode): void {
  const props = vnode.data?.props;
  const elm = vnode.elm as any;
  if (!props || !elm || !/^(INPUT|TEXTAREA|SELECT)$/.test(elm.tagName) || elm.type == 'file') return;
  const oldProps: any = oldVnode.data?.props || {};
  const {value, checked} = props;
  // Only the case propsModule skipped (prop unchanged); it handles real changes.
  if (value === oldProps.value && value != null && elm.value !== String(value)) {
    elm.value = String(value);
  }
  if (checked === oldProps.checked && checked != null && elm.checked !== !!checked) {
    elm.checked = !!checked;
  }
}

export const controlledInputModule = {update: syncControlled};
