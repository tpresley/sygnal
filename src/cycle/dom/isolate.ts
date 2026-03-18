import {Stream} from 'xstream';
import {VNode} from 'snabbdom';
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
      const scopeObj = getScopeObj(scope);
      const newNode = {
        ...(node as any),
        data: {
          ...node.data,
          isolate:
            !node.data || !Array.isArray((node.data as any).isolate)
              ? namespace.concat([scopeObj])
              : (node.data as any).isolate,
        },
      };
      return {
        ...newNode,
        key:
          newNode.key !== undefined
            ? newNode.key
            : JSON.stringify(newNode.data.isolate),
      } as T;
    });
  };
}

export function getScopeObj(scope: string): Scope {
  return {
    type: isClassOrId(scope) ? 'sibling' : 'total',
    scope,
  };
}
