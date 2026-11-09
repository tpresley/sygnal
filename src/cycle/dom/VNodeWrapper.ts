import {h, VNode, vnode as vnodeFn} from './snabbdom';

function selectorParser(sel: string) {
  const hashIdx = sel.indexOf('#');
  const dotIdx = sel.indexOf('.', hashIdx);
  const hash = hashIdx > 0 ? hashIdx : sel.length;
  const dot = dotIdx > 0 ? dotIdx : sel.length;
  return {
    tagName: hashIdx !== -1 || dotIdx !== -1 ? sel.slice(0, Math.min(hash, dot)) : sel,
    id: hash < dot ? sel.slice(hash + 1, dot) : void 0,
    className: dotIdx > 0 ? sel.slice(dot + 1).replace(/\./g, ' ') : '',
  };
}

/** the root vnode of a patch: the view's own when it is the mount point, else the mount point around it */
export function wrapVNode(root: any, vnode: VNode | null): VNode {
  const children = vnode === null ? [] : [vnode];
  if (root.nodeType === 11) return vnodeFn('', {isolate: []}, children, undefined, root);
  if (vnode !== null) {
    const {tagName, id, className} = selectorParser(vnode.sel || ''), data = vnode.data || {}, props = data.props || {};
    let c = className;
    if (data.class) c += ' ' + Object.keys(data.class).filter(k => data.class![k]).join(' ');
    if (props.className) c += ' ' + props.className;
    const {id: vnodeId = id} = props;
    if (
      typeof vnodeId === 'string' &&
      vnodeId.toUpperCase() === root.id.toUpperCase() &&
      tagName.toUpperCase() === root.tagName.toUpperCase() &&
      c.trim().toUpperCase() === root.className.toUpperCase()
    ) return vnode;
  }
  const {id, className} = root;
  return h(
    root.tagName.toLowerCase() + (id ? '#' + id : '') + (className ? '.' + className.split(' ').join('.') : ''),
    {isolate: []} as any,
    children
  );
}
