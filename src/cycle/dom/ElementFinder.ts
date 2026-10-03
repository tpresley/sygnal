import {ScopeChecker} from './ScopeChecker';
import {getSelectors} from './utils';
import {Scope} from './isolate';
import {IsolateModule} from './IsolateModule';

function toElArray(input: any): Array<Element> {
  return Array.prototype.slice.call(input) as Array<Element>;
}

export class ElementFinder {
  constructor(
    public namespace: Array<Scope>,
    public isolateModule: IsolateModule
  ) {}

  public call(): Array<Element> {
    const namespace = this.namespace;
    const selector = getSelectors(namespace);

    const scopeChecker = new ScopeChecker(namespace, this.isolateModule);
    // G-144: every root element of the scope (a fragment-rooted component has several)
    const topNodes = this.isolateModule.getElements(
      namespace.filter(n => n.type !== 'selector')
    );

    if (selector === '') {
      return topNodes;
    }

    return topNodes.reduce((out: Array<Element>, topNode) => out.concat(
      toElArray(topNode.querySelectorAll(selector)).filter(scopeChecker.isDirectlyInScope, scopeChecker),
      topNode.matches(selector) ? [topNode] : []
    ), []);
  }
}
