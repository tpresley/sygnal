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
 * leaves the field to the user. D196: a form-associated custom element is a field
 * too (its value is written as the prop). Other elements with a value prop
 * (<progress>, <meter>, custom elements that aren't form-associated) are left alone.
 *
 * (PLAN-4.6 R6, G-347: G-146's input stamps are gone with the old core: the core renders a
 * state in the flush it is written in, so no render shows an older state than the field.)
 */

import type {VNode} from 'snabbdom/build/vnode.js';

// P45-A: a form field by its vnode's tag (sel), checked before any other work: most vnodes aren't.
// D196: a form-associated custom element (a hyphenated tag whose class has `static
// formAssociated = true`, e.g. Web Awesome's wa-input / wa-rating) is a field too; only a
// hyphenated tag's element is read
export const isField = (vnode: VNode): any =>
  /^(input|textarea|select)(?![\w-])/i.test(vnode.sel as string) || /^\w+-/.test(vnode.sel as string) && (vnode.elm as any).constructor.formAssociated;

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
    // a custom element's value can be a number: compared as a string, written as the prop
    if (String(elm.value) !== v) elm.value = elm.constructor.formAssociated ? value : v;
  }
  if ('checked' in props && checked === oldProps.checked && elm.checked !== !!checked) {
    elm.checked = !!checked;
  }
}

export const controlledInputModule = {update: syncControlled};
