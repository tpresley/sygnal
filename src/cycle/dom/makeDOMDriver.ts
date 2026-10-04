import {Driver} from '../run/types';
import {init, Module, Options as SnabbdomOptions, VNode, toVNode} from './snabbdom';
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

function addRootScope(vnode: VNode): VNode {
  vnode.data = vnode.data || {};
  (vnode.data as any).isolate = [];
  return vnode;
}

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

    const firstRoot$ = domReady$.map(() => {
      const firstRoot = getValidNode(container) || document.body;
      vnodeWrapper = new VNodeWrapper(firstRoot);
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
    const rootElement$ = firstRoot$
      .map(
        firstRoot =>
          xs.merge(
            xs
              .merge(rememberedVNode$.endWhen(sanitation$), sanitation$)
              .map(vnode => vnodeWrapper.call(vnode))
              .startWith(addRootScope(toVNode(firstRoot)))
              .fold(patch, toVNode(firstRoot))
              .drop(1)
              .map(unwrapElementFromVNode)
              .startWith(firstRoot as any)
              .map((el: any) => (el.addEventListener(POKE, poke), cur = el)),
            // never completes (nor does the root element)
            xs.create<any>({start: l => pl = l, stop: () => pl = 0})
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
