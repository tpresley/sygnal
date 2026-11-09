import {IsolateModule} from './IsolateModule';
import {Scope} from './isolate';
import {inScope} from './utils';

// (the dev diagnostics' scope test: SYG104; the delegator has the scopes of the element it walks)
export class ScopeChecker {
  public readonly _namespace: Array<Scope>;
  constructor(
    public readonly namespace: Array<Scope>,
    private isolateModule: IsolateModule
  ) {
    this._namespace = namespace.filter(n => n.type !== 'selector');
  }

  public isDirectlyInScope(leaf: Element): boolean {
    const namespace = this.isolateModule.getNamespace(leaf);
    return !!namespace && inScope(this._namespace, namespace);
  }
}
