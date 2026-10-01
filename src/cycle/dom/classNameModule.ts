/**
 * Snabbdom module that unsets a removed `className` prop (B-012).
 *
 * Problem: `className` goes through snabbdom's propsModule, which writes new
 * and changed props but never unsets a prop that disappears. So when snabbdom
 * reuses an element (`<p className="placeholder">` -> `<p>`), the old class
 * stays. A nullish `className` is worse: propsModule writes the string
 * "null"/"false".
 *
 * Fix: runs after propsModule. When `className` is gone (or nullish/false),
 * drop the classes it had set, keeping the classes from the selector
 * (`p.foo`) and the truthy `class={{...}}` entries.
 */

import type {VNode} from 'snabbdom/build/vnode.js';

function classObject(vnode: VNode): Array<string> {
  const out: Array<string> = [];
  const klass: any = vnode.data?.class;
  if (klass && typeof klass === 'object') {
    for (const name in klass) if (klass[name]) out.push(name);
  }
  return out;
}

function baseClasses(vnode: VNode): Array<string> {
  const sel = vnode.sel || '';
  const hashIdx = sel.indexOf('#');
  const dotIdx = sel.indexOf('.', hashIdx);
  const fromSel = dotIdx > 0 ? sel.slice(dotIdx + 1).split('.') : [];
  return fromSel.concat(classObject(vnode));
}

function addAll(elm: any, names: Array<string>): void {
  for (const name of names) if (name) elm.classList.add(name);
}

const isSet = (cn: any) => cn != null && cn !== false;
const tokens = (cn: any) => (typeof cn === 'string' ? cn.split(/\s+/).filter(Boolean) : []);

function syncClassName(oldVnode: VNode, vnode: VNode): void {
  const elm = vnode.elm as any;
  if (!elm || !elm.classList) return;
  const props: any = vnode.data?.props;
  const oldProps: any = oldVnode.data?.props;
  const hasKey = !!props && 'className' in props;
  const cn = hasKey ? props.className : undefined;
  if (isSet(cn)) {
    // propsModule replaced the whole attribute: put the selector classes and the
    // class={{...}} entries back
    if (!oldProps || oldProps.className !== cn) addAll(elm, baseClasses(vnode));
    return;
  }
  if (hasKey) {
    // propsModule wrote String(cn) over the whole attribute: rebuild it
    if (!oldProps || oldProps.className !== cn) {
      elm.className = baseClasses(vnode).join(' ');
      if (elm.className === '') elm.removeAttribute('class');
    }
    return;
  }
  const oldCn = oldProps ? oldProps.className : undefined;
  if (!isSet(oldCn)) return;
  const keep = baseClasses(vnode);
  for (const name of tokens(oldCn)) {
    if (keep.indexOf(name) === -1) elm.classList.remove(name);
  }
  addAll(elm, keep);
  if (elm.getAttribute('class') === '') elm.removeAttribute('class');
}

export const classNameModule = {
  create: syncClassName,
  update: syncClassName,
};
