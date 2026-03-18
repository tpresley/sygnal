import {h, VNode, vnode as vnodeFn} from './snabbdom';
import {isDocFrag} from './utils';

function selectorParser(node: VNode) {
  if (!node.sel) {
    return { tagName: '', id: '', className: '' };
  }
  const sel = node.sel as string;
  const hashIdx = sel.indexOf('#');
  const dotIdx = sel.indexOf('.', hashIdx);
  const hash = hashIdx > 0 ? hashIdx : sel.length;
  const dot = dotIdx > 0 ? dotIdx : sel.length;
  const tagName = hashIdx !== -1 || dotIdx !== -1
    ? sel.slice(0, Math.min(hash, dot))
    : sel;
  const id = hash < dot ? sel.slice(hash + 1, dot) : void 0;
  const className = dotIdx > 0 ? sel.slice(dot + 1).replace(/\./g, ' ') : void 0;
  return { tagName, id, className };
}

function classNameFromVNode(vNode: VNode): string {
  let { className: cn = '' } = selectorParser(vNode);
  if (!vNode.data) return cn;
  const { class: dataClass, props } = vNode.data;
  if (dataClass) {
    const c = Object.keys(dataClass).filter((cl: string) => dataClass[cl]);
    cn += ` ${c.join(` `)}`;
  }
  if (props && props.className) {
    cn += ` ${props.className}`;
  }
  return cn && cn.trim();
}

export class VNodeWrapper {
  constructor(public rootElement: Element | DocumentFragment) {}

  public call(vnode: VNode | null): VNode {
    if (isDocFrag(this.rootElement)) {
      return this.wrapDocFrag(vnode === null ? [] : [vnode]);
    }
    if (vnode === null) {
      return this.wrap([]);
    }
    const {tagName: selTagName, id: selId} = selectorParser(vnode);
    const vNodeClassName = classNameFromVNode(vnode);
    const vNodeData = vnode.data || {};
    const vNodeDataProps = vNodeData.props || {};
    const {id: vNodeId = selId} = vNodeDataProps;

    const isVNodeAndRootElementIdentical =
      typeof vNodeId === 'string' &&
      vNodeId.toUpperCase() === this.rootElement.id.toUpperCase() &&
      selTagName.toUpperCase() === this.rootElement.tagName.toUpperCase() &&
      vNodeClassName.toUpperCase() === this.rootElement.className.toUpperCase();

    if (isVNodeAndRootElementIdentical) {
      return vnode;
    }

    return this.wrap([vnode]);
  }

  private wrapDocFrag(children: Array<VNode>) {
    return vnodeFn('', {isolate: []}, children, undefined, this
      .rootElement as any);
  }

  private wrap(children: Array<VNode>) {
    const {tagName, id, className} = this.rootElement as Element;
    const selId = id ? `#${id}` : '';
    const selClass = className ? `.${className.split(` `).join(`.`)}` : '';
    const vnode = h(
      `${tagName.toLowerCase()}${selId}${selClass}`,
      {},
      children
    );
    vnode.data = vnode.data || {};
    (vnode.data as any).isolate = (vnode.data as any).isolate || [];
    return vnode;
  }
}
