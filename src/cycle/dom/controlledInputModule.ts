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
 * string, `checked` as a boolean (1H-7). A present-but-nullish `value` keeps an
 * input/textarea at '' and a nullish `checked` at false (D49); an absent prop
 * leaves the field to the user. Other elements with a value prop
 * (<progress>, <meter>, custom elements with object values) are left alone.
 *
 * (PLAN-4.6 R6, G-347: G-146's input stamps are gone with the old core: the core renders a
 * state in the flush it is written in, so no render shows an older state than the field.)
 */

import type {VNode} from 'snabbdom/build/vnode.js';

// P45-A: a form field by its vnode's tag (sel), checked before any other work: most vnodes aren't
export const isField = (vnode: VNode): boolean => /^(input|textarea|select)(?![\w-])/i.test(vnode.sel as string);

function syncControlled(oldVnode: VNode, vnode: VNode): void {
  if (!isField(vnode)) return;
  const props = vnode.data?.props;
  const elm = vnode.elm as any;
  if (!props || !elm || elm.type == 'file') return;
  const oldProps: any = oldVnode.data?.props || {};
  const {value, checked} = props;
  // Only the case propsModule skipped (prop unchanged); it handles real changes.
  // A nullish <select> value is left alone: on create the browser shows the first option.
  if ('value' in props && value === oldProps.value && (value != null || elm.tagName != 'SELECT')) {
    const v = value == null ? '' : String(value);
    if (elm.value !== v) elm.value = v;
  }
  if ('checked' in props && checked === oldProps.checked && elm.checked !== !!checked) {
    elm.checked = !!checked;
  }
}

export const controlledInputModule = {update: syncControlled};
