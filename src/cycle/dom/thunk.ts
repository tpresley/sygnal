import {h, VNode, VNodeData} from './snabbdom';

export interface ThunkData extends VNodeData {
  fn(): VNode;
  args: Array<any>;
}

export interface Thunk extends VNode {
  data: ThunkData;
}

function copyToThunk(vnode: VNode, thunkVNode: Thunk): void {
  thunkVNode.elm = vnode.elm;
  (vnode.data as ThunkData).fn = thunkVNode.data.fn;
  (vnode.data as ThunkData).args = thunkVNode.data.args;
  (vnode.data as any).isolate = (thunkVNode.data as any).isolate;
  thunkVNode.data = vnode.data as ThunkData;
  thunkVNode.children = vnode.children;
  thunkVNode.text = vnode.text;
  thunkVNode.elm = vnode.elm;
}

function init(thunkVNode: Thunk): void {
  const cur = thunkVNode.data as VNodeData;
  const vnode = (cur as any).fn.apply(undefined, (cur as any).args);
  copyToThunk(vnode, thunkVNode);
}

function prepatch(oldVnode: Thunk, thunkVNode: Thunk): void {
  const old = oldVnode.data as VNodeData,
    cur = thunkVNode.data as VNodeData;
  let i: number;
  const oldArgs = (old as any).args,
    args = (cur as any).args;
  if ((old as any).fn !== (cur as any).fn || oldArgs.length !== args.length) {
    copyToThunk((cur as any).fn.apply(undefined, args), thunkVNode);
  }
  for (i = 0; i < args.length; ++i) {
    if (oldArgs[i] !== args[i]) {
      copyToThunk((cur as any).fn.apply(undefined, args), thunkVNode);
      return;
    }
  }
  copyToThunk(oldVnode, thunkVNode);
}

export function thunk(sel: string, fn: Function, args: Array<any>): Thunk;
export function thunk(
  sel: string,
  key: any,
  fn: Function,
  args: Array<any>
): Thunk;
export function thunk(sel: string, key?: any, fn?: any, args?: any): VNode {
  if (args === undefined) {
    args = fn;
    fn = key;
    key = undefined;
  }
  return h(sel, {
    key: key,
    hook: {init: init as any, prepatch: prepatch as any},
    fn: fn,
    args: args,
  } as VNodeData);
}

export default thunk;
