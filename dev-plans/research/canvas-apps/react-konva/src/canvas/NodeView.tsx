import type Konva from 'konva';
import { memo, useMemo } from 'react';
import { Ellipse, Group, Rect, Text } from 'react-konva';
import { useEditor } from '../store/editor';
import { useSession } from '../store/view';
import { registerKonva } from './registry';

// Applied to every shape: no hit graph (picking is geometric), no offscreen
// buffer for fill+stroke+opacity, no shadow pass for strokes.
const FAST = { perfectDrawEnabled: false, shadowForStrokeEnabled: false, listening: false } as const;

/**
 * One scene node. Each instance subscribes to its own node, so an edit
 * re-renders only the nodes whose objects changed (structural sharing in the store).
 */
export const NodeView = memo(function NodeView({ id, inDragLayer = false }: { id: string; inDragLayer?: boolean }) {
  const node = useEditor((s) => s.doc.nodes[id]);
  // While a drag runs, the dragged nodes are drawn by a copy in the drag layer.
  // The original is hidden, not unmounted: re-inserting thousands of siblings
  // costs React O(n) each (getHostSibling) and Konva O(n) each (child re-indexing).
  const movedOut = useSession((s) => !inDragLayer && s.dragging !== null && s.dragging.has(id));
  const editing = useSession((s) => s.editingTextId === id);
  // only the static instance is registered: it is what the Transformer attaches to
  const ref = useMemo(() => (inDragLayer ? undefined : registerKonva(id)), [id, inDragLayer]);
  const groupRef = useMemo(() => (g: Konva.Group | null) => frameRef(g, ref), [ref]);

  if (!node || !node.visible) return null;
  const common = {
    ref, id, x: node.x, y: node.y, rotation: node.rotation, opacity: node.opacity, visible: !movedOut,
    fill: node.fill, stroke: node.stroke, strokeWidth: node.strokeWidth, strokeEnabled: node.strokeWidth > 0,
    ...FAST,
  };
  switch (node.type) {
    case 'rect':
      return <Rect {...common} width={node.w} height={node.h} cornerRadius={node.cornerRadius} />;
    case 'ellipse':
      // Konva ellipses are centred on their origin; the offset keeps our
      // top-left origin so x/y/rotation mean the same thing for every type.
      return <Ellipse {...common} radiusX={node.w / 2} radiusY={node.h / 2} offsetX={-node.w / 2} offsetY={-node.h / 2} />;
    case 'text':
      return (
        <Text {...common} text={node.text} fontSize={node.fontSize} fontFamily="Inter, Arial, sans-serif"
          width={node.w} height={node.h} lineHeight={1.2} visible={!editing && !movedOut} />
      );
    case 'frame':
      return (
        <Group ref={groupRef} id={id} visible={!movedOut} x={node.x} y={node.y} rotation={node.rotation}
          opacity={node.opacity} clipX={0} clipY={0} clipWidth={node.w} clipHeight={node.h} listening={false}>
          <Rect name="frame-bg" width={node.w} height={node.h} fill={node.fill} stroke={node.stroke}
            strokeWidth={node.strokeWidth} strokeEnabled={node.strokeWidth > 0} cornerRadius={node.cornerRadius} {...FAST} />
          {node.children.map((c) => <NodeView key={c} id={c} inDragLayer={inDragLayer} />)}
        </Group>
      );
  }
});

/**
 * Konva measures a Group as the union of its children and ignores its clip, so a
 * Transformer around a frame would wrap overflowing children. Report the frame
 * rect instead.
 */
function frameRef(g: Konva.Group | null, register: ((n: Konva.Node | null) => (() => void) | undefined) | undefined) {
  if (!g) return;
  const original = g.getClientRect.bind(g);
  g.getClientRect = function (config = {}) {
    const bg = g.findOne('.frame-bg');
    if (!bg) return original(config);
    const rect = { x: 0, y: 0, width: bg.width(), height: bg.height() };
    if (config.skipTransform) return rect;
    return g._transformedRect(rect, config.relativeTo);
  };
  return register?.(g);
}
