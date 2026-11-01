// id → live Konva node. The Transformer and the drag code need the Konva
// instances, which react-konva only exposes through refs.
import type Konva from 'konva';

export const konvaNodes = new Map<string, Konva.Node>();

/** Ref callback factory; React 19 calls the returned cleanup on detach. */
export function registerKonva(id: string) {
  return (node: Konva.Node | null) => {
    if (!node) return;
    konvaNodes.set(id, node);
    return () => {
      if (konvaNodes.get(id) === node) konvaNodes.delete(id);
    };
  };
}
