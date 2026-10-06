import {Driver} from '../run/types';
import {init, Module, Options as SnabbdomOptions, VNode} from './snabbdom';
import xs, {Stream, Listener} from 'xstream';
import {MainDOMSource} from './MainDOMSource';
import {VNodeWrapper} from './VNodeWrapper';
import {getValidNode, checkValidContainer, POKE, flat} from './utils';
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

const ERR = 'data-sygnal-error';

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
// is written again: an iframe's src isn't reloaded). Any other attribute is removed now; so is a
// style (G-483: the style module writes the client's declarations, so none of the server's
// stays). A single text child keeps its text node. Whitespace and comments where the client has
// no text go; any other node that doesn't match stays as a placeholder that snabbdom replaces
// with the client's node, in place (the lists stay aligned, so the nodes after it are still
// adopted). Made again that way, as a fresh render makes them: an element whose selector has a
// class or id (G-486: `h('p.card')`, the Portal placeholder; patching never corrects them), and
// one whose hook expects a new element (G-485): a create or init hook (a thunk), an insert hook
// without a postpatch (a Transition's enter, a measured row, the toaster region, a lazy()
// placeholder), and any insert hook of the user's own (G-521: with a postpatch too; `u` when a
// ref, autoFocus or widget chained theirs after it; `s` marks a function chainHooks made)
const adopt = (e: any, v: any): any => {
  // (a hole, `{cond && <X/>}`, has no node: snabbdom skips it. G-481: no fragment either, they
  // are flat by now: their nodes pair with their children in their parent's run)
  const c = (v.children || []).filter((z: any) => z), out: any[] = [];
  for (let j = 0, x = e.firstChild, y: any; x; x = y) {
    const w = c[j], t = x.nodeType, d = w?.data || {}, k = d.hook;
    // a node that doesn't match stays in its place under a selector no vnode has: snabbdom makes
    // the client's node before it and removes it (the lists stay aligned: no other node is paired)
    let n: any = {sel: '', data: {}, elm: x};
    // G-520: client text vnodes next to each other (`Hello, {name}!`) are one server text node:
    // it is split by the client's text when that is its start, so the nodes after stay paired
    t == 3 && c[j + 1]?.text != null && !c[j + 1].sel && w?.text && x.data.startsWith(w.text) && x.splitText(w.text.length);
    y = x.nextSibling;
    if (t == 3 && w && !w.sel && w.text != null) n = {text: x.data, elm: x};
    else if (t == 1 && x.localName == w?.sel && !(k && (k.create || k.init || k.u || k.insert && !(k.postpatch && k.insert.s)))) {
      const p = d.props || {}, a = d.attrs || {}, o: any = {}, at: any = {}, pr: any = {}, f = x.firstChild;
      o.class = 'className';
      for (const m in p) o[m == 'htmlFor' ? 'for' : m.toLowerCase()] = m;
      // G-482: a data-* attribute the client sets as an attribute isn't in the dataset (the
      // dataset module would remove it): it goes, and the attributes module writes it again.
      // G-487: `open` (a <details> the user opened) stays when the client doesn't render it
      for (const {name: m, value: y} of [...x.attributes])
        /^data-/.test(m) ? m in a && x.removeAttribute(m)
        : m in a ? at[m] = y
        : m == 'open' ? 0
        : m in o && !d.ns ? pr[o[m]] = y
        : x.removeAttribute(m);
      // G-484: a textarea's value no longer follows its text, which goes
      x.localName == 'textarea' && (x.value = x.value);
      const s = w.text != null && f?.nodeType == 3 && !f.nextSibling;
      n = {sel: w.sel, key: w.key, data: {dataset: {...x.dataset}, attrs: at, props: pr}, children: s ? undefined : adopt(x, w), text: s ? f.data : undefined, elm: x};
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
    // G-545: run() gives any DOM driver its reporter (onError, phase 'patch') on the isolate
    // module; an explicit reportSnabbdomError comes first
    const rep = (e: any) => (options.reportSnabbdomError || (isolateModule as any).rep || console.error)(e);
    let dead = 0, end = 0;
    const rootElement$ = firstRoot$
      .map(
        (firstRoot, P = (o: any, v: any) => (v = flat(v), patch(o == r ? (cur.removeAttribute?.(ERR), {...r, sel: v.sel, key: v.key, children: adopt(firstRoot, v)}) : o, v))) =>
          xs.merge(
            xs
              .merge(rememberedVNode$.endWhen(sanitation$), sanitation$.map(() => (end = 1, null)))
              .map(vnode => vnodeWrapper.call(vnode))
              // the first step gives the root its scope; the second, the app's first patch,
              // adopts the markup in it (G-456). The root keeps its own attributes (G-466)
              .startWith(r)
              // G-540: a patch that throws (a hook, a module) is reported once, and the app's DOM
              // stops updating: snabbdom stopped half way (some elements patched, created or
              // removed, the rest not; insert hooks not run), and no vnode tree matches that DOM
              // (patching on from either tree, or adopting the DOM again, left wrong or duplicated
              // DOM). The stream doesn't end (its events, the root element), and a patch to no
              // children (dispose) still runs, so what the last good tree mounted (a Portal's
              // content) is removed; its errors aren't reported again. G-549: only dispose (`end`:
              // the sanitation signal), not a live render that has no children. G-543 (D224): the
              // root element is marked data-sygnal-error="patch" while its DOM is stopped (CSS can
              // show it; dispose removes it). G-550: marked before the error is reported (onError
              // can read it); the first patch clears a mark a failed, undisposed app left in the
              // container, and dispose removes it only when this app set it; a throw while
              // flattening the tree (a key JSON.stringify can't take) is a patch error too (P
              // flattens). A DocumentFragment mount point has no attributes: no mark
              .fold((o: any, v: any) => {
                if (!dead || end) try { o = P(o, v) } catch (e) { dead++ || (cur.setAttribute?.(ERR, 'patch'), rep(e)) }
                end && dead && cur.removeAttribute?.(ERR)
                return o
              }, {...r, data: {}})
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

    rootElement$.addListener({error: rep});

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
