/**
 * Local copy of snabbdom's styleModule with a fixed `window` guard.
 *
 * snabbdom 3.6.3 introduced a regression where the top-level `raf` assignment
 * evaluates `window` directly (via `window === null || window === void 0`)
 * before the `typeof` check, causing a ReferenceError in Node.js environments.
 *
 * This copy restores the safe `typeof window !== "undefined"` guard while
 * keeping all other 3.6.x improvements (arrow functions, `in` operator for
 * style removal checks, etc.).
 */

import {Module} from './snabbdom';

type VNode = { elm?: any; data?: any };

// Safe guard: `typeof window` never throws, even if `window` is undeclared.
const raf =
  (typeof window !== 'undefined' &&
    typeof window.requestAnimationFrame === 'function' &&
    window.requestAnimationFrame.bind(window)) ||
  setTimeout;

const nextFrame = (fn: () => void) => {
  raf(() => {
    raf(fn);
  });
};

let reflowForced = false;

function setNextFrame(obj: any, prop: string, val: string) {
  nextFrame(() => {
    obj[prop] = val;
  });
}

function updateStyle(oldVnode: VNode, vnode: VNode) {
  let cur: any;
  let name: string;
  const elm = vnode.elm as HTMLElement;
  let oldStyle = (oldVnode.data as any).style as Record<string, any> | undefined;
  let style = (vnode.data as any).style as Record<string, any> | undefined;
  if (!oldStyle && !style) return;
  if (oldStyle === style) return;
  oldStyle = oldStyle || {};
  style = style || {};
  const oldHasDel = 'delayed' in oldStyle;
  for (name in oldStyle) {
    if (!(name in style)) {
      if (name[0] === '-' && name[1] === '-') {
        elm.style.removeProperty(name);
      } else {
        (elm.style as any)[name] = '';
      }
    }
  }
  for (name in style) {
    cur = style[name];
    if (name === 'delayed' && style.delayed) {
      for (const name2 in style.delayed) {
        cur = style.delayed[name2];
        if (!oldHasDel || cur !== (oldStyle as any).delayed[name2]) {
          setNextFrame(elm.style, name2, cur);
        }
      }
    } else if (name !== 'remove' && cur !== (oldStyle as any)[name]) {
      if (name[0] === '-' && name[1] === '-') {
        elm.style.setProperty(name, cur);
      } else {
        (elm.style as any)[name] = cur;
      }
    }
  }
}

function applyDestroyStyle(vnode: VNode) {
  let style: Record<string, string>;
  let name: string;
  const elm = vnode.elm as HTMLElement;
  const s = (vnode.data as any).style;
  if (!s || !(style = s.destroy)) return;
  for (name in style) {
    (elm.style as any)[name] = style[name];
  }
}

function applyRemoveStyle(vnode: VNode, rm: () => void) {
  const s = (vnode.data as any).style;
  if (!s || !s.remove) {
    rm();
    return;
  }
  if (!reflowForced) {
    // Force reflow so transition styles apply immediately
    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
    (vnode.elm as HTMLElement).offsetLeft;
    reflowForced = true;
  }
  let name: string;
  const elm = vnode.elm as HTMLElement;
  let i = 0;
  const style = s.remove;
  let amount = 0;
  const applied: string[] = [];
  for (name in style) {
    applied.push(name);
    (elm.style as any)[name] = style[name];
  }
  const compStyle = getComputedStyle(elm);
  const props = (compStyle as any)['transition-property'].split(', ');
  for (; i < props.length; ++i) {
    if (applied.indexOf(props[i]) !== -1) amount++;
  }
  elm.addEventListener('transitionend', (ev: TransitionEvent) => {
    if (ev.target === elm) --amount;
    if (amount === 0) rm();
  });
}

function forceReflow() {
  reflowForced = false;
}

export const styleModule: Module = {
  pre: forceReflow,
  create: updateStyle,
  update: updateStyle,
  destroy: applyDestroyStyle,
  remove: applyRemoveStyle,
};
