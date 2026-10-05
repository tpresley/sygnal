import {Driver} from '../run/types';
import {init, Module, Options as SnabbdomOptions, VNode} from './snabbdom';
import xs, {Stream, Listener} from 'xstream';
import {MainDOMSource} from './MainDOMSource';
import {VNodeWrapper} from './VNodeWrapper';
import {getValidNode, checkValidContainer, POKE} from './utils';
import defaultModules from './modules';
import {IsolateModule} from './IsolateModule';
import {EventDelegator} from './EventDelegator';

function makeDOMDriverInputGuard(modules: Array<Partial<Module>> | unknown) {
  if (!Array.isArray(modules)) {
    throw new Error(
      `Optional modules option must be an array for snabbdom modules`
    );
  }
}

function domDriverInputGuard(view$: Stream<VNode>): void {
  if (
    !view$ ||
    typeof view$.addListener !== `function` ||
    typeof view$.fold !== `function`
  ) {
    throw new Error(
      `The DOM driver function expects as input a Stream of ` +
        `virtual DOM elements`
    );
  }
}

export interface DOMDriverOptions {
  modules?: Array<Partial<Module>>;
  reportSnabbdomError?(err: unknown): void;
  snabbdomOptions?: SnabbdomOptions;
}

function unwrapElementFromVNode(vnode: VNode): Element {
  return vnode.elm as Element;
}

function defaultReportSnabbdomError(err: any): void {
  (console.error || console.log)(err);
}

function makeDOMReady$(): Stream<null> {
  return xs.create<null>({
    start(lis: Listener<null>) {
      if (document.readyState === 'loading') {
        document.addEventListener('readystatechange', () => {
          const state = document.readyState;
          if (state === 'interactive' || state === 'complete') {
            lis.next(null);
            lis.complete();
          }
        });
      } else {
        lis.next(null);
        lis.complete();
      }
    },
    stop() {},
  });
}

// G-456 (D217): the app's first patch adopts markup already in the mount point (server HTML, an
// Astro island, a Vike page). Its old vnode is built from the DOM with the client's vnode as the
// template, by position (no toVNode): an element with the client's tag takes the client's
// selector and key (so component roots and Collection items match), and its data is what the
// modules need to reach the client's from what the server wrote: the dataset (stale keys go:
// data-sygnal-ssr), the class as the className prop (the className module drops stale classes),
// and each attribute the client sets as an attribute or a prop, with the server's value (nothing
// is written again: an iframe's src isn't reloaded). Any other attribute is removed now (a style
// only when the client sets none; class and id are left alone on a selector with them, as
// `h('p#a.b')`). A single text child keeps its text node. Whitespace and comments where the
// client has no text go; any other node that doesn't match stays as a placeholder that snabbdom
// replaces with the client's node, in place (the lists stay aligned, so the nodes after it are
// still adopted). An element whose hook has an insert and no postpatch (a Transition's enter, a
// measured row, the toaster region, a lazy() placeholder) is made again that way, as before
const adopt = (e: any, v: any): any => {
  const c = v.children || [], out: any[] = [];
  let j = 0;
  for (const x of [...e.childNodes]) {
    const w = c[j], t = x.nodeType, d = w?.data || {}, k = d.hook;
    // a node that doesn't match stays in its place under a selector no vnode has: snabbdom makes
    // the client's node before it and removes it (the lists stay aligned: no other node is paired)
    let n: any = {sel: '', data: {}, elm: x};
    if (t == 3 && w && !w.sel && w.text != null) n = {text: x.data, elm: x};
    else if (t == 1 && x.localName == w?.sel?.split(/[#.]/, 1)[0] && !(k?.insert && !k.postpatch)) {
      const p = d.props || {}, a = d.attrs || {}, o: any = {}, at: any = {}, pr: any = {}, f = x.firstChild;
      o.class = 'className';
      for (const m in p) o[m == 'htmlFor' ? 'for' : m.toLowerCase()] = m;
      for (const {name: m, value: y} of [...x.attributes])
        m in a ? at[m] = y
        : /^data-/.test(m) || m == 'style' && d.style || w.sel != x.localName && /^(class|id)$/.test(m) ? 0
        : m in o && !d.ns ? pr[o[m]] = y
        : x.removeAttribute(m);
      const s = w.text != null && f?.nodeType == 3 && !f.nextSibling;
      n = {sel: w.sel, data: {dataset: {...x.dataset}, attrs: at, props: pr}, children: s ? undefined : adopt(x, w), text: s ? f.data : undefined, elm: x, key: w.key};
    } else if (t != 1 && (t != 3 || !/\S/.test(x.data))) {
      x.remove();
      continue;
    }
    out.push(n);
    j++;
  }
  return out;
};

function makeDOMDriver(
  container: string | Element | DocumentFragment,
  options: DOMDriverOptions = {}
): Driver<Stream<VNode>, MainDOMSource> {
  checkValidContainer(container);
  const modules = options.modules || defaultModules;
  makeDOMDriverInputGuard(modules);
  const isolateModule = new IsolateModule();
  const snabbdomOptions = options && options.snabbdomOptions || undefined;
  const patch = init([isolateModule.createModule() as Partial<Module>].concat(modules), undefined, snabbdomOptions);
  const domReady$ = makeDOMReady$();
  let vnodeWrapper: VNodeWrapper;

  function DOMDriver(vnode$: Stream<VNode>, name = 'DOM'): MainDOMSource {
    domDriverInputGuard(vnode$);
    const sanitation$ = xs.create<null>();

    let r: any;
    const firstRoot$ = domReady$.map(() => {
      const firstRoot = getValidNode(container) || document.body;
      vnodeWrapper = new VNodeWrapper(firstRoot);
      r = {sel: '', data: {isolate: []}, elm: firstRoot};
      return firstRoot;
    });

    const rememberedVNode$ = vnode$.remember();
    rememberedVNode$.addListener({});

    // P45-C (rec 9, D146): the root element, when the DOM is ready and then after each patch
    // (it was a MutationObserver on the root's subtree: DOM changes made outside a patch no
    // longer emit)
    // G-261: and when Sygnal changes the DOM outside a patch (a Transition's leave, a Portal
    // mounted late): an event that bubbles up to the root. G-276: on the current root (a patch
    // can replace the first one). G-277: the innermost app's root takes it (a nested app or
    // custom element doesn't re-emit the outer app's DOM source)
    let pl: any, cur: any;
    const poke = (e: Event) => pl && (e.stopPropagation(), pl.next(cur));
    const off = () => cur?.removeEventListener(POKE, poke);
    const rootElement$ = firstRoot$
      .map(
        firstRoot =>
          xs.merge(
            xs
              .merge(rememberedVNode$.endWhen(sanitation$), sanitation$)
              .map(vnode => vnodeWrapper.call(vnode))
              // the first step gives the root its scope; the second, the app's first patch,
              // adopts the markup in it (G-456). The root keeps its own attributes (G-466)
              .startWith(r)
              .fold((o: any, v: any) => patch(o == r ? {...r, sel: v.sel, key: v.key, children: adopt(firstRoot, v)} : o, v), {...r, data: {}})
              .drop(1)
              .map(unwrapElementFromVNode)
              .startWith(firstRoot as any)
              .map((el: any) => (off(), el.addEventListener(POKE, poke), cur = el)),
            // never completes (nor does the root element). G-285: the listener moves with the
            // root and goes when the app stops (a disposed app's driver isn't kept by its root)
            xs.create<any>({start: l => pl = l, stop: () => (pl = 0, off())})
          )
      )
      .flatten()
      .endWhen(sanitation$)
      .remember();

    rootElement$.addListener({
      error: options.reportSnabbdomError || defaultReportSnabbdomError,
    });

    const delegator = new EventDelegator(rootElement$, isolateModule);

    return new MainDOMSource(
      rootElement$,
      sanitation$,
      [],
      isolateModule,
      delegator,
      name
    );
  }

  return DOMDriver as any;
}

export {makeDOMDriver};
