import {Stream} from 'xstream';
import {VNode} from './snabbdom';
import {isClassOrId} from './utils';

export interface Scope {
  type: 'sibling' | 'total' | 'selector';
  scope: string;
}

export type IsolateSink<T extends VNode> = (
  s: Stream<T>,
  scope: string
) => Stream<T>;

export function makeIsolateSink<T extends VNode>(
  namespace: Array<Scope>
): IsolateSink<T> {
  const value = makeIsolateValue(namespace);
  return (sink, scope) => scope === ':root' ? sink : sink.map(node => value(node, scope) as T);
}

/**
 * PLAN-4.6: the value-level isolateSink (the next core scopes each instance's vnode without a
 * stream per instance): the same mapping, applied to one vnode
 */
export function makeIsolateValue(namespace: Array<Scope>): (node: any, scope: string) => any {
  return (node, scope) => {
    if (scope === ':root' || !node) {
      return node;
    }
    const isolate = namespace.concat([getScopeObj(scope)]);
    const newNode = scoped(node, isolate);
    return {
      ...newNode,
      key:
        newNode.key !== undefined
          ? newNode.key
          : JSON.stringify((newNode.data && newNode.data.isolate) || isolate),
    };
  };
}

// G-144: a fragment has no element of its own, so each of its top-level elements (through
// nested fragments) carries the scope; the fragment keeps the key
function scoped(node: any, isolate: Array<Scope>): any {
  return !node || typeof node != 'object' ? node
    : node.sel ? {...node, data: {...node.data, isolate: node.data && Array.isArray(node.data.isolate) ? node.data.isolate : isolate}}
    : node.children ? {...node, children: node.children.map((c: any) => scoped(c, isolate))}
    : node;
}

export function getScopeObj(scope: string): Scope {
  return {
    type: isClassOrId(scope) ? 'sibling' : 'total',
    scope,
  };
}
