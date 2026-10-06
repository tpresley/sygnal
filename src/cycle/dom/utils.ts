import {Scope} from './isolate';

function isValidNode(obj: any): obj is Element {
  const ELEM_TYPE = 1;
  const FRAG_TYPE = 11;
  return typeof HTMLElement === 'object'
    ? obj instanceof HTMLElement || obj instanceof DocumentFragment
    : obj &&
        typeof obj === 'object' &&
        obj !== null &&
        (obj.nodeType === ELEM_TYPE || obj.nodeType === FRAG_TYPE) &&
        typeof obj.nodeName === 'string';
}

export function isClassOrId(str: string): boolean {
  return str.length > 1 && (str[0] === '.' || str[0] === '#');
}

export function isDocFrag(
  el: Element | DocumentFragment
): el is DocumentFragment {
  return el.nodeType === 11;
}

export function checkValidContainer(
  container: Element | DocumentFragment | string
): void {
  if (typeof container !== 'string' && !isValidNode(container)) {
    throw new Error(
      'Given container is not a DOM element neither a selector string.'
    );
  }
}

export function getValidNode(
  selectors: Element | DocumentFragment | string
): Element | DocumentFragment | null {
  const domElement =
    typeof selectors === 'string'
      ? document.querySelector(selectors)
      : selectors;

  if (typeof selectors === 'string' && domElement === null) {
    throw new Error(`Cannot render into unknown element \`${selectors}\``);
  }
  return domElement;
}

export function getSelectors(namespace: Array<Scope>): string {
  let res = '';
  for (let i = namespace.length - 1; i >= 0; i--) {
    if (namespace[i].type !== 'selector') {
      break;
    }
    res = namespace[i].scope + ' ' + res;
  }
  return res.trim();
}

export function isEqualNamespace(
  a: Array<Scope> | undefined,
  b: Array<Scope> | undefined
): boolean {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i++) {
    if (a[i].type !== b[i].type || a[i].scope !== b[i].scope) {
      return false;
    }
  }
  return true;
}

export function makeInsert(
  map: Map<string, Map<Element, any>>
): (type: string, elm: Element, value: any) => void {
  return (type, elm, value) => {
    if (map.has(type)) {
      const innerMap = map.get(type)!;
      innerMap.set(elm, value);
    } else {
      const innerMap = new Map<Element, any>();
      innerMap.set(elm, value);
      map.set(type, innerMap);
    }
  };
}

// G-261: a DOM change Sygnal makes outside a patch (a Transition's leave, a Portal mounted late)
// re-emits the DOM source of the app whose root contains `el` (makeDOMDriver listens on its root)
export const POKE = 'sygnal-dom';
export const pokeDOM = (el: any): any => el?.dispatchEvent(new Event(POKE, {bubbles: true}));

const obj = (o: any) => o !== null && typeof o == 'object' && !Array.isArray(o);
/**
 * P46-P: two vnodes' data are the same for the DOM modules: the same keys, each value identical
 * or a shallow-equal object (a module bucket: props, attrs, class, dataset, style, ...)
 */
export function sameData(a: any, b: any): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  let n = 0;
  for (const k in a) {
    n++;
    const x = a[k], y = b[k];
    if (x !== y) {
      if (!obj(x) || !obj(y)) return false;
      let m = 0;
      for (const j in x) { m++; if (x[j] !== y[j]) return false; }
      for (const _ in y) m--;
      if (m) return false;
    }
  }
  for (const _ in b) n--;
  return !n;
}

// G-517 / G-518 / G-522: snabbdom never sees a fragment. Before each patch, a fragment's children
// (through nested ones) are spliced into its parent's children, so they are diffed, moved and
// adopted at hydration as the parent's own (snabbdom's fragment bounds went stale: an insert into
// one landed at the parent's end, a keyed one never moved, a later patch threw NotFoundError).
// The children of a keyed fragment (a Collection item, a component's root) take its key and their
// own key, else their tag and its count among them: they move with it and stay apart from another
// item's. A vnode with no fragment below is kept by identity, as is one already flattened (a
// cached subtree), so snabbdom still skips unchanged subtrees; so are a keyed fragment's copies
// while the fragment and its prefix are the same (G-539). A copy (a
// parent with new children, a child with a new key) inherits from its vnode and writes its
// element there too, so the app's vnodes get their `elm` as before (testing and diagnostics read
// it); it keeps its own (a vnode object reused under another key: the old copy removes its own).
const flatOf = new WeakMap<any, any>();
const copy = (y: any, o: any, m?: any) => Object.create(y, {...o, elm: {get: () => m, set: (e: any) => y.elm = m = e}});
export const flat = (v: any): any => {
  if (!v || v.$p || !v.children) return v;
  let r = flatOf.get(v);
  if (!r) {
    const o: any[] = [];
    let d = 0;
    // (p, m, s: locals of each call)
    const put = (c: any[], k?: string, n: any = {}, p?: any, m?: any, s?: any) => {
      for (const x of c) {
        // G-539: a keyed fragment's copies are kept per (fragment, prefix), in flatOf (flat() never
        // takes a fragment): an unchanged one (a Collection item that didn't render again) gives
        // snabbdom the same vnodes
        if (x && !x.sel && x.children) d = 1, x.key == null ? put(x.children, k, n)
          : (m = flatOf.get(x))?.[0] == (p = [k] + x.key + '/') ? o.push(...m[1])
          : (s = o.length, put(x.children, p), flatOf.set(x, [p, o.slice(s)]));
        else {
          let y = flat(x);
          y !== x && (d = 1);
          if (k && y) {
            const j = k + (y.key ?? y.sel + '#' + (n[y.sel] = -~n[y.sel]));
            y = copy(y, {key: {value: j}});
          }
          o.push(y);
        }
      }
    };
    put(v.children);
    flatOf.set(v, r = d ? copy(v, {children: {value: o}}) : v);
  }
  return r;
};
