/**
 * Snabbdom module that clears removed and nullish props (B-015).
 *
 * Problem: snabbdom's propsModule writes new and changed props but never
 * unsets a prop that disappears, so a reused element keeps `title`, `disabled`,
 * `href`, ... from the previous render. A nullish prop is written as the
 * string "undefined"/"null" (`title={cond ? 'x' : undefined}`).
 *
 * Fix: runs after propsModule. For each prop that is gone (or became nullish),
 * reset the property by its current type (boolean -> false, string -> '',
 * other non-number -> undefined/null) and remove the reflected attribute, so
 * numbers (maxLength, ...) fall back to their default too. `className` is left
 * to classNameModule (B-012); `value`/`checked` on form fields are left alone
 * (the controlled-input module owns them; removing them hands control back to
 * the user, as in React).
 */

import type {VNode} from 'snabbdom/build/vnode.js';

function clearProp(elm: any, key: string): void {
  if (key === 'className' || (/^(value|checked)$/.test(key) && /^(INPUT|TEXTAREA|SELECT)$/.test(elm.tagName))) return;
  const cur = elm[key];
  const t = typeof cur;
  try {
    if (t === 'boolean') elm[key] = false;
    else if (t === 'string') elm[key] = '';
    else if (t !== 'number') elm[key] = cur === null || t === 'function' ? null : undefined;
  } catch (_) {
    // e.g. contentEditable rejects '': removing the attribute below resets it
  }
  const attr = key === 'htmlFor' ? 'for' : key.replace(/^aria(?=[A-Z])/, 'aria-').toLowerCase();
  // (a no-op when the attribute is absent)
  elm.removeAttribute?.(attr);
}

function syncRemoved(oldVnode: VNode, vnode: VNode): void {
  const elm: any = vnode.elm;
  const props: any = vnode.data?.props;
  const oldProps: any = oldVnode.data?.props;
  if (!elm || oldProps === props) return;
  for (const key in oldProps) {
    if (!props || !(key in props)) clearProp(elm, key);
  }
  for (const key in props) {
    if (props[key] == null && (!oldProps || oldProps[key] !== props[key])) clearProp(elm, key);
  }
}

export const removedPropsModule = {create: syncRemoved, update: syncRemoved};
