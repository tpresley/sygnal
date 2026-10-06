import {VNode} from './snabbdom';
import {EventDelegator} from './EventDelegator';
import {Scope} from './isolate';
import {isEqualNamespace} from './utils';
import SymbolTree from './SymbolTree';

// G-356 (D196): the element an event bubbles to and a scope walk goes up to: a moved element's
// home (`__sygnalHome`), else its parent. G-381: a home inside the element (a cycle) isn't
// followed, nor more than 98 homes per walk (`c` counts them: two elements naming each other)
export const upOf = (e: any, c: any): any => {
  const h = e.__sygnalHome;
  return h && !e.contains(h) && (c.$h = (c.$h | 0) + 1) < 99 ? h : e.parentNode;
};

export class IsolateModule {
  // G-144: a scope can own several root elements (a fragment-rooted component)
  private namespaceTree = new SymbolTree<Set<Element>, Scope>(x => x.scope);
  private namespaceByElement: WeakMap<Element, Array<Scope>>;
  private eventDelegator: EventDelegator | undefined;

  private vnodesBeingRemoved: Array<Element>;

  constructor() {
    this.namespaceByElement = new WeakMap<Element, Array<Scope>>();
    this.vnodesBeingRemoved = [];
  }

  public setEventDelegator(del: EventDelegator): void {
    this.eventDelegator = del;
  }

  private insertElement(namespace: Array<Scope>, el: Element): void {
    this.namespaceByElement.set(el, namespace);
    this.namespaceTree.get(namespace, () => new Set())!.add(el);
  }

  // the element keeps its scope (a leaving element under a Transition still is the
  // child's); only the scope's set of root elements forgets it
  private removeElement(elm: Element): void {
    const namespace = this.namespaceByElement.get(elm);
    const els = namespace && this.namespaceTree.get(namespace);
    if (els) {
      els.delete(elm);
      // P45-A: an unmounted scope leaves no node behind
      if (!els.size) this.namespaceTree.delete(namespace!);
    }
  }

  public getElements(namespace: Array<Scope>): Array<Element> {
    return [...(this.namespaceTree.get(namespace) || [])];
  }

  public getRootElement(elm: Element): Element | undefined {
    if (this.namespaceByElement.has(elm)) {
      return elm;
    }

    // G-356 (D196): an element a hook moved out of its component's DOM (a toaster region
    // re-parented into an open modal <dialog>) names where it belongs as `__sygnalHome` (an
    // element of its component), so it stays in its component's scope. With no scope root above
    // elm (moved without one, or out of the app) the event has no scope here (before: threw
    // 'No root element found'). G-381: upOf guards against a home cycle
    let curr = elm;
    const c = {};
    while (!this.namespaceByElement.has(curr)) {
      curr = upOf(curr, c);
      if (!curr || curr.tagName === 'HTML') {
        return undefined;
      }
    }
    return curr;
  }

  public getNamespace(elm: Element): Array<Scope> | undefined {
    const rootElement = this.getRootElement(elm);
    if (!rootElement) {
      return undefined;
    }
    return this.namespaceByElement.get(rootElement) as Array<Scope>;
  }

  public createModule() {
    const self = this;
    // G-564: a vnode can be in the old tree and the new one (a component's cached vnode, a
    // Collection item's copy, a hoisted vnode). When an ancestor is recreated (`alt ? <ol>{c}</ol>
    // : <ul>{c}</ul>`, a new key), snabbdom creates it again and gives it the new element before it
    // destroys the old subtree, so destroy hooks saw the new element (a widget inside wasn't
    // unmounted, its scope lost the new element). A created element notes its children's elements
    // (M: a child with one is mounted, or was), before they are created; a destroyed vnode gives
    // its noted children their old elements back for their destroy hooks (and theirs, down the
    // subtree), and they get the new ones again when the removal starts (S), before the insert
    // hooks. (A vnode that moves to another parent still gives its own destroy hook the new one)
    const M = new Map<any, any>(), S: any[] = [];
    // G-573: a vnode in the new tree twice: its first note (its element before the patch) wins.
    // A destroy hook that throws ends the patch before remove / post: the next patch first gives
    // the vnodes their new elements back and forgets the notes (pre)
    const back = (c: any) => M.has(c) && (S.push(c, c.elm), c.elm = M.get(c));
    const ret = () => { for (let e; S.length; ) e = S.pop(), S.pop().elm = e; };
    return {
      pre() {
        ret();
        M.clear();
      },

      create(emptyVNode: VNode, vNode: VNode) {
        const {elm, data = {}, children} = vNode;
        const namespace: Array<Scope> = (data as any).isolate;

        if (Array.isArray(namespace)) {
          self.insertElement(namespace, elm as Element);
        }
        children?.forEach((c: any) => c?.elm && M.set(c, M.get(c) || c.elm));
      },

      update(oldVNode: VNode, vNode: VNode) {
        const {elm: oldElm, data: oldData = {}} = oldVNode;
        const {elm, data = {}} = vNode;
        const oldNamespace: Array<Scope> = (oldData as any).isolate;
        const namespace: Array<Scope> = (data as any).isolate;

        if (!isEqualNamespace(oldNamespace, namespace)) {
          if (Array.isArray(oldNamespace)) {
            self.removeElement(oldElm as Element);
          }
        }
        if (Array.isArray(namespace)) {
          self.insertElement(namespace, elm as Element);
        }
      },

      // (the elements as they are now: post runs after the vnodes got their new ones back)
      destroy(vNode: VNode) {
        vNode.children?.forEach(back);
        self.vnodesBeingRemoved.push(vNode.elm as Element);
      },

      remove(vNode: VNode, cb: Function) {
        self.vnodesBeingRemoved.push(vNode.elm as Element);
        ret();
        cb();
      },

      post() {
        // G-144: a removed root element is no longer one of its scope's roots (an element no
        // scope has as a root isn't in any set: removing it does nothing)
        for (const elm of self.vnodesBeingRemoved) {
          self.removeElement(elm);
          (self.eventDelegator as EventDelegator).removeElement(elm);
        }
        self.vnodesBeingRemoved = [];
        M.clear();
      },
    };
  }
}
