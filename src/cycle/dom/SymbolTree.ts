type Node<Payload> = [Payload | undefined, InternalTree<Payload>];

interface InternalTree<Payload> {
  [name: string]: Node<Payload>;
}

export default class SymbolTree<Payload, T> {
  private tree: Node<Payload> = [undefined, {}];

  constructor(private mapper: (t: T) => string) {}

  public get(
    path: Array<T>,
    mkDefaultElement?: () => Payload,
    max?: number
  ): Payload | undefined {
    let curr = this.tree;
    const _max = max !== undefined ? max : path.length;
    for (let i = 0; i < _max; i++) {
      const n = this.mapper(path[i]);
      let child: Node<Payload> = curr[1][n];
      if (!child) {
        if (mkDefaultElement) {
          child = [undefined, {}];
          curr[1][n] = child;
        } else {
          return undefined;
        }
      }
      curr = child;
    }
    if (mkDefaultElement && !curr[0]) {
      curr[0] = mkDefaultElement();
    }
    return curr[0];
  }
}
