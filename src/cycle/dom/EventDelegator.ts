import xs, {Stream, Subscription} from 'xstream';
import {ScopeChecker} from './ScopeChecker';
import {IsolateModule, upOf} from './IsolateModule';
import {getSelectors, isEqualNamespace} from './utils';
import {ElementFinder} from './ElementFinder';
import {EventsFnOptions} from './DOMSource';
import {Scope} from './isolate';
import SymbolTree from './SymbolTree';
import PriorityQueue from './PriorityQueue';
import {
  fromEvent,
  preventDefaultConditional,
  PreventDefaultOpt,
} from './fromEvent';

declare var requestIdleCallback: any;

interface Destination {
  useCapture: boolean;
  bubbles: boolean;
  passive: boolean;
  scopeChecker: ScopeChecker;
  subject: Stream<Event>;
  preventDefault?: PreventDefaultOpt;
}

export interface CycleDOMEvent extends Event {
  propagationHasBeenStopped: boolean;
  ownerTarget: Element;
}

export const eventTypesThatDontBubble = [
  // Focus
  `blur`,
  `focus`,
  // Mouse
  `mouseenter`,
  `mouseleave`,
  // Pointer
  `pointerenter`,
  `pointerleave`,
  `gotpointercapture`,
  `lostpointercapture`,
  // Media (and img/script/link error, abort)
  `abort`,
  `error`,
  `loadstart`,
  `progress`,
  `canplay`,
  `canplaythrough`,
  `durationchange`,
  `emptied`,
  `ended`,
  `loadeddata`,
  `loadedmetadata`,
  `pause`,
  `play`,
  `playing`,
  `ratechange`,
  `seeked`,
  `seeking`,
  `stalled`,
  `suspend`,
  `timeupdate`,
  `volumechange`,
  `waiting`,
  // Resource
  `load`,
  `unload`,
  // Form
  `invalid`,
  `reset`,
  `submit`,
  `formdata`,
  // details, popover, dialog
  `toggle`,
  `beforetoggle`,
  `cancel`,
  `close`,
  // Animation / Transition
  `animationstart`,
  `animationend`,
  `animationiteration`,
  `transitionrun`,
  `transitionstart`,
  `transitionend`,
  // Scroll
  `scroll`,
  `scrollend`,
];

interface DOMListener {
  sub: Subscription;
  passive: boolean;
}

interface NonBubblingListener {
  sub: Subscription | undefined;
  destination: Destination;
}

// [subject, type, finder, destination, number of started streams]
type NonBubblingMeta = [Stream<Event>, string, ElementFinder, Destination, number]

export class EventDelegator {
  private virtualListeners = new SymbolTree<
    Map<string, PriorityQueue<Destination>>,
    Scope
  >(x => x.scope);
  private origin: Element | undefined;

  private domListeners: Map<string, DOMListener>;
  private nonBubblingListeners: Map<string, Map<Element, NonBubblingListener>>;
  private domListenersToAdd: Map<string, boolean>;
  private nonBubblingListenersToAdd = new Set<NonBubblingMeta>();

  private virtualNonBubblingListener: Array<Destination> = [];

  constructor(
    private rootElement$: Stream<Element>,
    public isolateModule: IsolateModule
  ) {
    this.isolateModule.setEventDelegator(this);
    this.domListeners = new Map<string, DOMListener>();
    this.domListenersToAdd = new Map<string, boolean>();
    this.nonBubblingListeners = new Map<
      string,
      Map<Element, NonBubblingListener>
    >();
    rootElement$.addListener({
      next: (el: Element) => {
        if (this.origin !== el) {
          this.origin = el;
          this.resetEventListeners();
          this.domListenersToAdd.forEach((passive, type) =>
            this.setupDOMListener(type, passive)
          );
          this.domListenersToAdd.clear();
        }

        this.nonBubblingListenersToAdd.forEach(arr => {
          this.setupNonBubblingListener(arr);
        });
      },
    });
  }

  public addEventListener(
    eventType: string,
    namespace: Array<Scope>,
    options: EventsFnOptions,
    bubbles?: boolean
  ): Stream<Event> {
    const scopeChecker = new ScopeChecker(namespace, this.isolateModule);

    const shouldBubble =
      bubbles === undefined
        ? eventTypesThatDontBubble.indexOf(eventType) === -1
        : bubbles;

    if (shouldBubble) {
      if (!this.domListeners.has(eventType)) {
        this.setupDOMListener(eventType, !!options.passive);
      }

      // P45-A: the destination is in the delegator only while the stream has listeners, so
      // a disposed component leaves nothing behind (audit rec 3). Each stream has its own
      // destination; xstream counts the stream's own listeners
      let dest: Destination;
      const out: Stream<Event> = xs.create({
        start: () => {
          dest = this.insertListener(out, scopeChecker, eventType, options);
        },
        stop: () => this.removeListener(dest, eventType),
      });
      return out;
    }

    // one record, and one listener per element, per type and scope: the streams on it share
    // it, and the last one to stop removes it. G-263: a stream finds (or makes) the live record
    // each time it starts, so a stream never started leaves none, and one restarted after its
    // record was removed shares the record made meanwhile
    let rec: NonBubblingMeta | undefined, subscription: any;
    return xs.create({
      start: listener => {
        rec = undefined;
        this.nonBubblingListenersToAdd.forEach(x => {
          if (!rec && x[1] === eventType && isEqualNamespace(x[2].namespace, namespace)) rec = x;
        });
        if (!rec) {
          const s = xs.never();
          rec = [s, eventType, new ElementFinder(namespace, this.isolateModule), this.insertListener(s, scopeChecker, eventType, options), 0];
          this.nonBubblingListenersToAdd.add(rec);
        }
        if (!rec[4]++) this.setupNonBubblingListener(rec);
        subscription = rec[0].subscribe(listener);
      },
      stop: () => {
        const r = rec!;
        subscription.unsubscribe();
        if (!--r[4]) {
          const map = this.nonBubblingListeners.get(eventType);
          if (map) map.forEach((l, element: any) => {
            if (l.destination === r[3]) {
              l.sub!.unsubscribe();
              delete element.subs[eventType];
              map.delete(element);
            }
          });
          this.nonBubblingListenersToAdd.delete(r);
          this.removeListener(r[3], eventType);
        }
      },
    });
  }

  public removeElement(element: Element): void {
    const types: Array<string> = [];
    this.nonBubblingListeners.forEach((map, type) => {
      if (map.has(element)) {
        types.push(type);
        const subs = (element as any).subs;
        if (subs) Object.keys(subs).forEach(key => subs[key].unsubscribe());
      }
    });
    types.forEach(type => {
      const map = this.nonBubblingListeners.get(type);
      if (!map) return;
      map.delete(element);
      if (!map.size) this.nonBubblingListeners.delete(type);
    });
  }

  // the queues a destination goes in: its scope's and its ancestors' up to the nearest total scope
  private eachSet(
    n: Array<Scope>,
    eventType: string,
    f: (map: Map<string, PriorityQueue<Destination>>, max: number) => void,
    create?: boolean
  ): void {
    let max = n.length;
    do {
      const map = this.virtualListeners.get(n, create ? () => new Map() : undefined, max);
      if (map) f(map, max);
      max--;
    } while (max >= 0 && n[max].type !== 'total');
  }

  private insertListener(
    subject: Stream<Event>,
    scopeChecker: ScopeChecker,
    eventType: string,
    options: EventsFnOptions
  ): Destination {
    const n = scopeChecker._namespace;
    const destination = {
      ...options,
      scopeChecker,
      subject,
      bubbles: !!options.bubbles,
      useCapture: !!options.useCapture,
      passive: !!options.passive,
    };

    this.eachSet(n, eventType, map => {
      if (!map.has(eventType)) map.set(eventType, new PriorityQueue<Destination>());
      map.get(eventType)!.add(destination, n.length);
    }, true);

    return destination;
  }

  // P45-A: take a stopped stream's destination out, and drop the queues and scopes left empty
  private removeListener(dest: Destination, eventType: string): void {
    const n = dest.scopeChecker._namespace;
    this.eachSet(n, eventType, (map, max) => {
      const q = map.get(eventType);
      if (q && !q.delete(dest)) {
        map.delete(eventType);
        if (!map.size) this.virtualListeners.delete(n, max);
      }
    });
  }

  private getVirtualListeners(
    eventType: string,
    namespace: Array<Scope>
  ): PriorityQueue<Destination> {
    // up to the innermost total scope (none: the root's)
    let _max = namespace.length;
    while (_max && namespace[_max - 1].type !== 'total') _max--;

    // a lookup never adds a scope (P45-A)
    const map = this.virtualListeners.get(namespace, undefined, _max);
    return (map && map.get(eventType)) || ([] as any);
  }

  private setupDOMListener(eventType: string, passive: boolean): void {
    if (this.origin) {
      const sub = fromEvent(
        this.origin,
        eventType,
        false,
        false,
        passive
      ).subscribe({
        next: (event: Event) => this.onEvent(eventType, event, passive),
        error: () => {},
        complete: () => {},
      });
      this.domListeners.set(eventType, {sub, passive});
    } else {
      this.domListenersToAdd.set(eventType, passive);
    }
  }

  private setupNonBubblingListener(
    input: NonBubblingMeta
  ): void {
    const [_, eventType, elementFinder, destination, started] = input;
    if (!this.origin || !started) {
      return;
    }

    elementFinder.call().forEach((element: Element) => {
      const subs = (element as any).subs;
      if (!subs || !subs[eventType]) {
        const sub = fromEvent(
          element,
          eventType,
          false,
          false,
          destination.passive
        ).subscribe({
          next: (ev: Event) =>
            this.onEvent(eventType, ev, !!destination.passive, false),
          error: () => {},
          complete: () => {},
        });
        let map = this.nonBubblingListeners.get(eventType);
        if (!map) this.nonBubblingListeners.set(eventType, map = new Map());
        map.set(element, {sub, destination});

        (element as any).subs = {
          ...subs,
          [eventType]: sub,
        };
      }
    });
  }

  private resetEventListeners(): void {
    this.domListeners.forEach(({sub, passive}, type) => {
      sub.unsubscribe();
      this.setupDOMListener(type, passive);
    });
  }

  private putNonBubblingListener(
    eventType: string,
    elm: Element,
    useCapture: boolean,
    passive: boolean
  ): void {
    const map = this.nonBubblingListeners.get(eventType);
    if (!map) {
      return;
    }
    const listener = map.get(elm);
    if (
      listener &&
      listener.destination.passive === passive &&
      listener.destination.useCapture === useCapture
    ) {
      this.virtualNonBubblingListener[0] = listener.destination;
    }
  }

  private onEvent(
    eventType: string,
    event: Event,
    passive: boolean,
    bubbles = true
  ): void {
    const cycleEvent = this.patchEvent(event);
    const target = event.target as Element;
    const rootElement = this.isolateModule.getRootElement(target);

    if (bubbles) {
      const namespace = this.isolateModule.getNamespace(target);
      if (!namespace) {
        return;
      }
      const listeners = this.getVirtualListeners(eventType, namespace);
      const phase = (useCapture: boolean) => this.bubble(
        eventType,
        target,
        rootElement,
        cycleEvent,
        listeners,
        namespace,
        namespace.length - 1,
        useCapture,
        passive
      );
      phase(true);
      phase(false);
    } else {
      const phase = (useCapture: boolean) => {
        this.putNonBubblingListener(eventType, target, useCapture, passive);
        this.doBubbleStep(
          eventType,
          target,
          rootElement,
          cycleEvent,
          this.virtualNonBubblingListener,
          useCapture,
          passive
        );
      };
      phase(true);
      phase(false);
      event.stopPropagation();
    }
  }

  private bubble(
    eventType: string,
    elm: Element,
    rootElement: Element | undefined,
    event: CycleDOMEvent,
    listeners: PriorityQueue<Destination>,
    namespace: Array<Scope>,
    index: number,
    useCapture: boolean,
    passive: boolean
  ): void {
    if (!useCapture && !event.propagationHasBeenStopped) {
      this.doBubbleStep(
        eventType,
        elm,
        rootElement,
        event,
        listeners,
        useCapture,
        passive
      );
    }

    // G-356: a moved element bubbles to its home (an element of its component), not to the
    // element it was moved into (G-381: upOf counts the homes on the event)
    const up = upOf(elm, event) as Element;
    let newRoot: Element | undefined = rootElement;
    let newIndex = index;
    let newListeners = listeners;
    if (elm === rootElement) {
      if (index < 0 || !up) {
        return;
      }
      // the parent scope's root that contains elm (G-144: it may have several)
      newRoot = this.isolateModule.getRootElement(up);
      newIndex--;
      // G-145: like the browser, the event bubbles out of a total scope (a child
      // component) to the parent's own elements; their listeners live in the parent's
      // scope, and isDirectlyInScope keeps them from matching the child's elements
      if (namespace[index].type === 'total') {
        newListeners = this.getVirtualListeners(eventType, namespace.slice(0, index));
      }
    }

    if (up && newRoot) {
      this.bubble(
        eventType,
        up,
        newRoot,
        event,
        newListeners,
        namespace,
        newIndex,
        useCapture,
        passive
      );
    }

    if (useCapture && !event.propagationHasBeenStopped) {
      this.doBubbleStep(
        eventType,
        elm,
        rootElement,
        event,
        listeners,
        useCapture,
        passive
      );
    }
  }

  private doBubbleStep(
    eventType: string,
    elm: Element,
    rootElement: Element | undefined,
    event: CycleDOMEvent,
    listeners: PriorityQueue<Destination> | Array<Destination>,
    useCapture: boolean,
    passive: boolean
  ): void {
    if (!rootElement) {
      return;
    }
    this.mutateEventCurrentTarget(event, elm);
    listeners.forEach(dest => {
      if (dest.passive === passive && dest.useCapture === useCapture) {
        const sel = getSelectors(dest.scopeChecker.namespace);
        if (
          !event.propagationHasBeenStopped &&
          dest.scopeChecker.isDirectlyInScope(elm) &&
          (sel ? elm.matches(sel) : elm === rootElement)
        ) {
          preventDefaultConditional(
            event,
            dest.preventDefault as PreventDefaultOpt
          );

          dest.subject.shamefullySendNext(event);
        }
      }
    });
  }

  private patchEvent(event: Event): CycleDOMEvent {
    const pEvent = event as CycleDOMEvent;
    pEvent.propagationHasBeenStopped = false;
    const oldStopPropagation = pEvent.stopPropagation;
    pEvent.stopPropagation = function stopPropagation() {
      oldStopPropagation.call(this);
      this.propagationHasBeenStopped = true;
    };
    return pEvent;
  }

  private mutateEventCurrentTarget(
    event: CycleDOMEvent,
    currentTargetElement: Element
  ) {
    try {
      Object.defineProperty(event, `currentTarget`, {
        value: currentTargetElement,
        configurable: true,
      });
    } catch (err) {
      // Some browsers don't allow redefining currentTarget.
      // event.ownerTarget is always set as a reliable alternative.
    }
    event.ownerTarget = currentTargetElement;
  }
}
