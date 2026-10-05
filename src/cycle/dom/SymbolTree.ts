// [payload, children, number of children]: the count makes delete's "is this node empty" O(1)
// (G-290: Object.keys(children) per removal made removing n siblings O(n²))
type Node<Payload> = [Payload | undefined, InternalTree<Payload>, number];

interface InternalTree<Payload> {
  [name: string]: Node<Payload>;
}

export default class SymbolTree<Payload, T> {
  private tree: Node<Payload> = [, {}, 0];

  constructor(private mapper: (t: T) => string) {}

  public get(
    path: Array<T>,
    mkDefaultElement?: () => Payload,
    max = path.length
  ): Payload | undefined {
    let curr = this.tree;
    for (let i = 0; i < max; i++) {
      const n = this.mapper(path[i]);
      if (!curr[1][n]) {
        if (!mkDefaultElement) return undefined;
        curr[2]++; // G-290: count the children
        curr[1][n] = [, {}, 0];
      }
      curr = curr[1][n];
    }
    if (mkDefaultElement && !curr[0]) {
      curr[0] = mkDefaultElement();
    }
    return curr[0];
  }

  // P45-A: drop the payload at path and prune the nodes left empty; true when node is empty
  public delete(path: Array<T>, max = path.length, node = this.tree, i = 0): boolean {
    if (i < max) {
      const k = this.mapper(path[i]), child = node[1][k];
      if (child && this.delete(path, max, child, i + 1)) delete node[1][k], node[2]--;
    } else node[0] = undefined;
    return !node[0] && !node[2];
  }
}
