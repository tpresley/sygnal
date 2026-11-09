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
  private namespaceByElement = new WeakMap<Element, Array<Scope>>();
  private eventDelegator: EventDelegator | undefined;

  // Sift #4: the anchors of the Portals mounted from this app (their content is outside its root):
  // the delegator listens on them too, and ElementFinder looks in them
  public portals = new Set<Element>();

  public setEventDelegator(del: EventDelegator | any): void {
    this.eventDelegator = del;
  }

  /** a Portal's anchor mounted (`on`) or removed: the delegator's listeners move with it */
  public portal(el: Element, on: boolean): void {
    on ? this.portals.add(el) : this.portals.delete(el);
    this.eventDelegator?.resetEventListeners();
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
    const insert = (namespace: Array<Scope>, el: Element) => {
      this.namespaceByElement.set(el, namespace);
      this.namespaceTree.get(namespace, () => new Set())!.add(el);
    };
    // the element keeps its scope (a leaving element under a Transition still is the
    // child's); only the scope's set of root elements forgets it
    const forget = (elm: Element) => {
      const namespace = this.namespaceByElement.get(elm);
      const els = namespace && this.namespaceTree.get(namespace);
      if (els) {
        els.delete(elm);
        // P45-A: an unmounted scope leaves no node behind
        if (!els.size) this.namespaceTree.delete(namespace!);
      }
    };
    const removed: Array<Element> = [];
    // G-564, G-750, G-753: a vnode can be in the old tree and the new one (a component's cached
    // vnode, a Collection item's copy, a hoisted vnode). Under another parent element (a recreated
    // ancestor: `alt ? <ol>{c}</ol> : <ul>{c}</ul>`; a keyed instance moved to another column, or
    // into a new row that takes its old place among its siblings) snabbdom created it again and
    // gave it the new element while the old tree still had it: its destroy hooks saw the new
    // element (a widget inside wasn't unmounted, its scope lost the new element), its old parent
    // removed the new element and left the old one (G-750), or inserted a new sibling before it,
    // inside that sibling (NotFoundError, the patch stopped: G-753). Now an element that is
    // created or patched takes a copy of each child that has an element and isn't one of its old
    // children (only a mounted vnode has one), before it is created: the old tree keeps the vnode
    // and its element. The copy's children array is its own, so its children are copied when it
    // is created. After the patch (post) each vnode takes its copy's fields (its element) and its
    // place again, so the next patch sees the same vnode (snabbdom's shortcut). A patch that
    // throws keeps the copies (pre forgets them): they still work, as copies
    const R: any[] = [];
    const copy = (a: any[], i: number) => { R.push(a, i, a[i]); a[i] = {...a[i], children: a[i].children?.slice()} };
    return {
      pre() {
        R.length = 0;
      },

      create(emptyVNode: VNode, vNode: VNode) {
        const {elm, data, children} = vNode;
        const namespace: Array<Scope> = (data as any)?.isolate;

        if (Array.isArray(namespace)) insert(namespace, elm as Element);
        children?.forEach((c: any, i: number) => c?.elm && copy(children, i));
      },

      update(oldVNode: VNode, vNode: VNode) {
        const oldNamespace: Array<Scope> = (oldVNode.data as any)?.isolate;
        const namespace: Array<Scope> = (vNode.data as any)?.isolate;

        if (oldNamespace !== namespace) {
          if (Array.isArray(oldNamespace) && !isEqualNamespace(oldNamespace, namespace)) forget(oldVNode.elm as Element);
          if (Array.isArray(namespace)) insert(namespace, vNode.elm as Element);
        }
        // (oldVNode !== vNode here: snabbdom returns early for the same vnode; the Set only when a
        // child isn't at its old index)
        const oc = oldVNode.children, nc: any = vNode.children
        let o: any
        nc?.forEach((c: any, i: number) => c?.elm && c !== oc?.[i] && !(o ||= new Set(oc)).has(c) && copy(nc, i));
      },

      destroy(vNode: VNode) {
        removed.push(vNode.elm as Element);
      },

      remove(vNode: VNode, cb: Function) {
        removed.push(vNode.elm as Element);
        cb();
      },

      post: () => {
        for (let i = 0; i < R.length; i += 3) R[i][R[i + 1]] = Object.assign(R[i + 2], R[i][R[i + 1]]);
        R.length = 0;
        // G-144: a removed root element is no longer one of its scope's roots (an element no
        // scope has as a root isn't in any set: removing it does nothing)
        for (const elm of removed) {
          forget(elm);
          this.eventDelegator!.removeElement(elm);
        }
        removed.length = 0;
      },
    };
  }
}
