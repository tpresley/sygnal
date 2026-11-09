import {getSelectors, inScope} from './utils';
import {Scope} from './isolate';
import {IsolateModule} from './IsolateModule';

/** the elements a namespace (its isolation scopes and selectors) selects, in document order per root */
export function findElements(namespace: Array<Scope>, iso: IsolateModule): Array<Element> {
  const selector = getSelectors(namespace), scopes = namespace.filter(n => n.type !== 'selector');
  // G-144: every root element of the scope (a fragment-rooted component has several)
  const topNodes = iso.getElements(scopes);
  if (!selector) return topNodes;

  const inside = (root: Element) => Array.from(root.querySelectorAll(selector)).filter(el => {
    const ns = iso.getNamespace(el);
    return !!ns && inScope(scopes, ns);
  });
  const found = topNodes.reduce((out: Array<Element>, topNode) => out.concat(inside(topNode), topNode.matches(selector) ? [topNode] : []), []);
  // Sift #4: and in the content of the app's Portals, whose elements are in the scope of the
  // component that renders the Portal (their anchor's home is its placeholder)
  const ps = iso.portals;
  if (!ps.size) return found;
  ps.forEach(a => found.push(...inside(a)));
  return [...new Set(found)];
}
