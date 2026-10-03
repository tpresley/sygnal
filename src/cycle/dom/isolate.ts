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
  return (sink, scope) => {
    if (scope === ':root') {
      return sink;
    }

    return sink.map(node => {
      if (!node) {
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
      } as T;
    });
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
