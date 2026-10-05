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
export function makeIsolateValue(namespace: Array<Scope>): ((node: any, scope: string) => any) & {for(scope: string): (node: any) => any} {
  const f: any = (node: any, scope: string) => f.for(scope)(node);
  // G-304: one function per scope (an instance keeps it), with the namespace and its key made once
  f.for = (scope: string) => {
    if (scope === ':root') return (node: any) => node;
    const isolate = namespace.concat([getScopeObj(scope)]);
    let key: string | undefined;
    return (node: any) => {
      if (!node) return node;
      const newNode = scoped(node, isolate);
      return {
        ...newNode,
        key:
          newNode.key !== undefined
            ? newNode.key
            : newNode.data && newNode.data.isolate !== isolate && newNode.data.isolate
              ? JSON.stringify(newNode.data.isolate)
              : (key ??= JSON.stringify(isolate)),
      };
    };
  };
  return f;
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
