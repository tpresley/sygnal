import xs, {Stream} from 'xstream';
import {IsolateModule, upOf} from './IsolateModule';
import {getSelectors, inScope, scopeKey} from './utils';
import {findElements} from './ElementFinder';
import {EventsFnOptions} from './DOMSource';
import {Scope} from './isolate';
import {deliver} from '../../shared';
import {preventDefaultConditional, PreventDefaultOpt} from './fromEvent';

// one per stream, in the delegator only while the stream has listeners (P45-A)
interface Destination {
  type: string;
  ns: Array<Scope>;
  scopes: Array<Scope>; // the isolation scopes of ns
  sel: string;
  key: string; // its queue
  capture: boolean;
  passive: boolean;
  preventDefault?: PreventDefaultOpt;
  out: Stream<Event>;
}

export interface CycleDOMEvent extends Event {
  propagationHasBeenStopped: boolean;
  ownerTarget: Element;
}

export const eventTypesThatDontBubble = (
  // focus; mouse; pointer
  'blur focus mouseenter mouseleave pointerenter pointerleave gotpointercapture lostpointercapture ' +
  // media (and img/script/link error, abort)
  'abort error loadstart progress canplay canplaythrough durationchange emptied ended loadeddata ' +
  'loadedmetadata pause play playing ratechange seeked seeking stalled suspend timeupdate volumechange waiting ' +
  // resource; form; details, popover, dialog
  'load unload invalid reset submit formdata toggle beforetoggle cancel close ' +
  // animation / transition; scroll
  'animationstart animationend animationiteration transitionrun transitionstart transitionend scroll scrollend'
).split(' ');

interface DOMListener {
  off?: () => void;
  passive: boolean;
}

// one DOM listener per element and type, delivering to every destination set up on the
// element: snabbdom may reuse it for another selector, and two selectors may match it
interface ElementListener extends DOMListener {
  dests: Array<Destination>;
}

const NONE: Array<Destination> = [];

const listen = (el: Element, type: string, passive: boolean, f: (e: any) => void) => {
  el.addEventListener(type, f, {passive});
  return () => el.removeEventListener(type, f);
};

const setCurrentTarget = (event: CycleDOMEvent, el: Element) => {
  try {
    Object.defineProperty(event, `currentTarget`, {value: el, configurable: true});
  } catch (err) {
    // Some browsers don't allow redefining currentTarget.
    // event.ownerTarget is always set as a reliable alternative.
  }
  event.ownerTarget = el;
};

// a destination's queue is its type's and its scope path's up to the innermost total scope: an
// element's scope reads the same one (none: the root's)
const queueKey = (type: string, ns: Array<Scope>, max = ns.length) => {
  while (max && ns[max - 1].type !== 'total') max--;
  return type + scopeKey(ns, max);
};

export function makeEventDelegator(root$: Stream<Element>, iso: IsolateModule) {
  let origin: Element | undefined;
  const queues = new Map<string, Array<Destination>>();
  const rootListeners = new Map<string, DOMListener>();
  const elementListeners = new Map<string, Map<Element, ElementListener>>();
  // the started non-bubbling destinations: each patch may bring elements to listen on
  const records = new Set<Destination>();
  // per type: the started non-passive bubbling destinations; the root listener is passive only
  // while there are none
  const active: Record<string, number> = {};

  const queueOf = (type: string, ns: Array<Scope>, max?: number) => queues.get(queueKey(type, ns, max)) || NONE;

  const listenOnRoots = (type: string, l: DOMListener) => {
    l.off?.();
    // Sift #4: on the root and on each mounted Portal's anchor (an event from a Portal's content
    // bubbles from the anchor to its placeholder: IsolateModule's upOf)
    const offs = origin ? [origin, ...iso.portals].map(el => listen(el, type, l.passive, e => onEvent(type, e, true, el))) : [];
    l.off = () => offs.forEach(f => f());
  };

  const resetEventListeners = () => rootListeners.forEach((l, type) => listenOnRoots(type, l));

  const countActive = (type: string, d: number) => {
    const passive = !(active[type] = (active[type] || 0) + d);
    let l = rootListeners.get(type);
    if (!l) rootListeners.set(type, l = {passive}), listenOnRoots(type, l);
    else if (l.passive !== passive) l.passive = passive, listenOnRoots(type, l);
  };

  const listenOnElement = (el: Element, type: string, l: ElementListener, passive: boolean) => {
    l.off?.();
    l.off = listen(el, type, l.passive = passive, e => onEvent(type, e, false));
  };

  const attach = (d: Destination) => {
    if (!origin) return;
    let map = elementListeners.get(d.type);
    if (!map) elementListeners.set(d.type, map = new Map());
    for (const el of findElements(d.ns, iso)) {
      let l = map.get(el);
      if (!l) map.set(el, l = {dests: [d], passive: d.passive}), listenOnElement(el, d.type, l, d.passive);
      else {
        if (!l.dests.includes(d)) l.dests.push(d);
        // a passive listener can't preventDefault: a non-passive destination replaces it
        if (l.passive && !d.passive) listenOnElement(el, d.type, l, false);
      }
    }
  };

  const detach = (d: Destination) => {
    elementListeners.get(d.type)?.forEach((l, el, map) => {
      const i = l.dests.indexOf(d);
      if (i < 0) return;
      l.dests.splice(i, 1);
      if (!l.dests.length) l.off!(), map.delete(el);
      else if (!l.passive && l.dests.every(x => x.passive)) listenOnElement(el, d.type, l, true);
    });
  };

  // deeper scopes first (a scope path's sibling scopes share its queue), else in start order
  const enqueue = (d: Destination) => {
    const q = queues.get(d.key);
    if (!q) return queues.set(d.key, [d]);
    const i = q.findIndex(x => x.scopes.length < d.scopes.length);
    q.splice(i < 0 ? q.length : i, 0, d);
  };

  const dequeue = (d: Destination) => {
    const q = queues.get(d.key)!;
    q.splice(q.indexOf(d), 1);
    if (!q.length) queues.delete(d.key);
  };

  const run = (event: CycleDOMEvent, elm: Element, root: Element, ns: Array<Scope>, dests: Array<Destination>, capture: boolean) => {
    for (let i = 0; i < dests.length; i++) {
      const d = dests[i];
      // every destination, passive or not: the one root listener is non-passive while any is
      if (d.capture === capture && !event.propagationHasBeenStopped && inScope(d.scopes, ns) && (d.sel ? elm.matches(d.sel) : elm === root)) {
        setCurrentTarget(event, elm);
        preventDefaultConditional(event, d.preventDefault as PreventDefaultOpt);
        d.out.shamefullySendNext(event);
      }
    }
  };

  // the steps of the event's way up, [element, its scope root, the queue, the root's namespace]*
  const pathOf = (type: string, event: Event, target: Element, root: Element, ns: Array<Scope>): Array<any> => {
    const path: Array<any> = [];
    let elm = target, r: Element | undefined = root, i = ns.length - 1, q = queueOf(type, ns), n = ns;
    for (;;) {
      path.push(elm, r, q, n);
      // G-356: a moved element bubbles to its home (an element of its component), not to the
      // element it was moved into (G-381: upOf counts the homes on the event)
      const up: Element = upOf(elm, event);
      if (elm === r) {
        if (i < 0 || !up) break;
        // the parent scope's root that contains elm (G-144: it may have several)
        r = iso.getRootElement(up);
        if (r) n = iso.getNamespace(r)!;
        // G-145: like the browser, the event bubbles out of a total scope (a child component)
        // to the parent's own elements; their listeners live in the parent's scope, and the
        // scope check keeps them from matching the child's elements
        if (ns[i].type === 'total') q = queueOf(type, ns, i);
        i--;
      }
      if (!up || !r) break;
      elm = up;
    }
    return path;
  };

  const onEvent = (type: string, event: Event, bubbles: boolean, at?: Element) => {
    // Sift #4: an event heard on several of the listening elements (a Portal's target inside the
    // root) is delivered by the innermost one only
    const ps = iso.portals;
    if (at && ps.size) {
      let n: any = event.target;
      while (n && n !== origin && !ps.has(n)) n = n.parentNode;
      if (n && n !== at) return;
    }
    // 7.2: the event is recorded while it is delivered (the core's onDispatch hook)
    deliver(event, () => {
      const e = event as CycleDOMEvent, stop = e.stopPropagation;
      e.propagationHasBeenStopped = false;
      e.stopPropagation = function stopPropagation() {
        stop.call(this);
        this.propagationHasBeenStopped = true;
      };
      const target = e.target as Element, root = iso.getRootElement(target), ns = root && iso.getNamespace(root);
      // (a copy of the element's destinations: one may stop while the event is delivered)
      const path = !ns ? []
        : bubbles ? pathOf(type, e, target, root!, ns)
        : [target, root, elementListeners.get(type)?.get(target)?.dests.slice() || NONE, ns];
      for (let i = path.length - 4; i >= 0; i -= 4) run(e, path[i], path[i + 1], path[i + 3], path[i + 2], true);
      for (let i = 0; i < path.length; i += 4) run(e, path[i], path[i + 1], path[i + 3], path[i + 2], false);
      // as if the event stopped at each element on its way: it reads the last one it reached
      if (path.length && !e.propagationHasBeenStopped) setCurrentTarget(e, path[path.length - 4]);
      if (!bubbles) e.stopPropagation();
    });
  };

  const self = {
    queues,
    elementListeners,
    records,
    resetEventListeners,

    addEventListener(
      type: string,
      ns: Array<Scope>,
      options: EventsFnOptions,
      bubbles = !eventTypesThatDontBubble.includes(type)
    ): Stream<Event> {
      const scopes = ns.filter(n => n.type !== 'selector'), p = options.passive ? 0 : 1;
      const d: Destination = {
        type,
        ns,
        scopes,
        sel: getSelectors(ns),
        key: queueKey(type, scopes),
        capture: !!options.useCapture,
        passive: !!options.passive,
        preventDefault: options.preventDefault,
        out: xs.create<Event>({
          start() {
            enqueue(d);
            if (bubbles) countActive(type, p);
            else records.add(d), attach(d);
          },
          stop() {
            dequeue(d);
            if (bubbles) countActive(type, -p);
            else records.delete(d), detach(d);
          },
        }),
      };
      return d.out;
    },

    removeElement(el: Element): void {
      elementListeners.forEach((map, type) => {
        const l = map.get(el);
        if (l) {
          l.off!();
          map.delete(el);
          if (!map.size) elementListeners.delete(type);
        }
      });
    },
  };

  iso.setEventDelegator(self);
  root$.addListener({
    next: (el: Element) => {
      if (origin !== el) {
        origin = el;
        resetEventListeners();
      }
      records.forEach(attach);
    },
  });
  return self;
}

export type EventDelegator = ReturnType<typeof makeEventDelegator>;
