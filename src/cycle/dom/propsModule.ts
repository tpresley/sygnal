/**
 * Sygnal's props module: snabbdom's propsModule, plus clearing removed and
 * nullish props (B-015, G-109).
 *
 * Problem: snabbdom's propsModule writes new and changed props but never
 * unsets a prop that disappears, so a reused element keeps `title`, `disabled`,
 * `href`, ... from the previous render. A nullish prop is written as the
 * string "undefined"/"null" (`title={cond ? 'x' : undefined}`, `src={null}`).
 *
 * Fix: write new and changed props except nullish ones (G-109: nothing is ever
 * written as "null"). For each prop that is gone (or became nullish), remove
 * the reflected attribute, which resets the property (numbers such as
 * maxLength fall back to their default too). Without such an attribute, reset
 * the property by its current type (boolean -> false, string -> '', other
 * non-number -> undefined/null) if it differs (G-095). `className` is left
 * to classNameModule (B-012). On form fields a nullish `value`/`checked` clears
 * the field ('' / false, D49); a removed one is left alone (the controlled-input
 * module owns them; removing them hands control back to the user, as in React).
 */

import type {VNode} from 'snabbdom/build/vnode.js';
import {isStale} from './controlledInputModule';

function clearProp(elm: any, key: string, nullish?: boolean): void {
  if (key === 'className') return;
  if (/^(value|checked)$/.test(key) && /^(INPUT|TEXTAREA|SELECT)$/.test(elm.tagName)) {
    const empty = key === 'value' ? '' : false;
    if (nullish && elm[key] !== empty) elm[key] = empty;
    return;
  }
  const attr = key === 'htmlFor' ? 'for' : key.replace(/^aria(?=[A-Z])/, 'aria-').toLowerCase();
  // G-095: a reflected attribute is just removed, which resets the property. Writing it first
  // (src = '') would queue an img/video error event or navigate an iframe to about:blank.
  if (elm.hasAttribute?.(attr)) return elm.removeAttribute(attr);
  const cur = elm[key];
  const t = typeof cur;
  const reset = t === 'boolean' ? false : t === 'string' ? '' : cur === null || t === 'function' ? null : undefined;
  try {
    // numbers (maxLength, ...) are left to their default; unchanged values aren't rewritten
    if (t !== 'number' && cur !== reset) elm[key] = reset;
  } catch (_) {
    // e.g. contentEditable rejects ''
  }
}

function updateProps(oldVnode: VNode, vnode: VNode): void {
  const elm: any = vnode.elm;
  const props: any = vnode.data?.props || {};
  const oldProps: any = oldVnode.data?.props || {};
  if (!elm || oldProps === props) return;
  // G-146: the user typed into this form field after the state being rendered
  const stale = isStale(vnode);
  for (const key in oldProps) {
    if (!(key in props)) clearProp(elm, key);
  }
  for (const key in props) {
    const cur = props[key];
    if (cur === oldProps[key] || (stale && (key === 'value' || key === 'checked'))) continue;
    // a nullish className is left to classNameModule, which rebuilds the attribute (B-012)
    if (cur == null) clearProp(elm, key, true);
    else if (key !== 'value' || elm[key] !== cur) elm[key] = cur;
  }
}

export const propsModule = {create: updateProps, update: updateProps};
