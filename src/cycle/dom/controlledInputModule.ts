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
 * G-146: renders lag the state by a few ms (debounced), so with fast typing a
 * render built from an older state could write its older `value` over text the
 * user has typed since, dropping keystrokes. Each `input` event on a form field
 * takes a number from a global counter; a component stamps the vnodes it renders
 * with the counter as of the state and props they show (`data.inputSeq`). A form field whose last input is newer than the render's
 * stamp keeps its live `value`/`checked` while a newer render is on its way: that
 * render, of a state that saw the input, writes the field (value={null}, model
 * rewrites, resets included).
 */

import type {VNode} from 'snabbdom/build/vnode.js';

let seq = 0, changed = 0;
const lastInput = new WeakMap<Element, number>();
/**
 * A component's render inputs (state, props, ...) changed: the stamp for the render
 * that will show them is the input counter now
 */
export const renderSeq = (): number => (changed = seq);
// P45-A: a form field by its vnode's tag (sel), checked before any other work: most vnodes aren't
export const isField = (vnode: VNode): boolean => /^(input|textarea|select)(?![\w-])/i.test(vnode.sel as string);
/**
 * The vnode is older than the form field's live value: the user changed the field after
 * the render's state, and some state changed since, so a newer render is on its way. (A
 * reducer that ignores the input changes nothing; that render is then the current one.)
 */
export const isStale = (vnode: VNode): boolean => {
  const at = (vnode.data as any)?.inputSeq ?? Infinity;
  return (lastInput.get(vnode.elm as Element) || 0) > at && changed > at;
};

function track(_: VNode, vnode: VNode): void {
  const elm = vnode.elm as Element;
  // a listener on the field itself runs before the app's delegated one (and its reducer)
  if (isField(vnode)) elm.addEventListener('input', () => lastInput.set(elm, ++seq));
}

function syncControlled(oldVnode: VNode, vnode: VNode): void {
  if (!isField(vnode)) return;
  const props = vnode.data?.props;
  const elm = vnode.elm as any;
  if (!props || !elm || elm.type == 'file' || isStale(vnode)) return;
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

export const controlledInputModule = {create: track, update: syncControlled};
