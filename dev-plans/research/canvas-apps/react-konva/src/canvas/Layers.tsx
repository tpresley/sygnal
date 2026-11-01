// The Konva layers. Each is a separate <canvas>: the static layer keeps its
// pixels while only the drag layer and the overlay redraw during a drag.
import type Konva from 'konva';
import { memo, useLayoutEffect, useMemo, type RefObject } from 'react';
import { Group, Layer, Line, Rect, Transformer } from 'react-konva';
import { boundsOf, isEffectivelyLocked, isEffectivelyVisible, worldMatrix } from '../model/doc';
import { rotationOf } from '../model/geometry';
import { useEditor } from '../store/editor';
import { useCamera, useOverlay, useSession } from '../store/view';
import { NodeView } from './NodeView';
import { konvaNodes } from './registry';

const ACCENT = '#0d99ff';

export const StaticLayer = memo(function StaticLayer({ contentRef }: { contentRef: RefObject<Konva.Group | null> }) {
  const root = useEditor((s) => s.doc.root);
  return (
    <Layer listening={false}>
      <Group ref={contentRef}>
        {root.map((id) => <NodeView key={id} id={id} />)}
      </Group>
    </Layer>
  );
});

/**
 * Renders copies of the dragged nodes; the drag code moves `groupRef`
 * imperatively. The group is keyed by the drag set, so React mounts and removes
 * the whole subtree in one operation instead of child by child.
 */
export const DragLayer = memo(function DragLayer({ groupRef }: { groupRef: RefObject<Konva.Group | null> }) {
  const dragging = useSession((s) => s.dragging);
  const key = useMemo(() => (dragging ? Math.random().toString(36) : ''), [dragging]);
  return (
    <Layer listening={false}>
      {dragging && (
        <Group key={key} ref={groupRef}>
          {[...dragging].map((id) => <InParentSpace key={id} id={id} />)}
        </Group>
      )}
    </Layer>
  );
});

/** A node lifted out of a frame keeps its ancestors' transform. */
function InParentSpace({ id }: { id: string }) {
  const doc = useEditor((s) => s.doc);
  const parentId = doc.nodes[id]?.parentId;
  const m = useMemo(() => (parentId ? worldMatrix(doc, parentId) : null), [doc, parentId]);
  if (!m) return <NodeView id={id} inDragLayer />;
  return (
    <Group x={m[4]} y={m[5]} rotation={rotationOf(m)}>
      <NodeView id={id} inDragLayer />
    </Group>
  );
}

export const OverlayLayer = memo(function OverlayLayer({ trRef }: { trRef: RefObject<Konva.Transformer | null> }) {
  return (
    <Layer>
      <Guides />
      <SelectionTransformer trRef={trRef} />
    </Layer>
  );
});

function Guides() {
  const { guides, marquee, draft, dragDelta, dragBounds } = useOverlay();
  // strokeScaleEnabled={false}: 1 screen px at every zoom without subscribing to the camera
  const line = { stroke: '#f24822', strokeWidth: 1, strokeScaleEnabled: false, listening: false } as const;
  return (
    <>
      {guides.map((g, i) => (
        <Line key={i} {...line} points={g.axis === 'x' ? [g.at, g.from, g.at, g.to] : [g.from, g.at, g.to, g.at]} />
      ))}
      {dragBounds && dragDelta && (
        <Rect x={dragBounds.x + dragDelta.x} y={dragBounds.y + dragDelta.y} width={dragBounds.w} height={dragBounds.h}
          stroke={ACCENT} strokeWidth={1} strokeScaleEnabled={false} listening={false} />
      )}
      {marquee && (
        <Rect x={marquee.x} y={marquee.y} width={marquee.w} height={marquee.h} fill="rgba(13,153,255,0.08)"
          stroke={ACCENT} strokeWidth={1} strokeScaleEnabled={false} listening={false} />
      )}
      {draft && (
        <Rect x={draft.x} y={draft.y} width={draft.w} height={draft.h} stroke={ACCENT} strokeWidth={1}
          strokeScaleEnabled={false} listening={false} />
      )}
    </>
  );
}

// ---- Transformer -------------------------------------------------------------------

/** Width/height of a Konva node in model terms, per node type. */
function sizeOf(n: Konva.Node): { w: number; h: number } {
  const className = n.getClassName();
  if (className === 'Ellipse') return { w: (n as Konva.Ellipse).radiusX() * 2, h: (n as Konva.Ellipse).radiusY() * 2 };
  if (className === 'Group') return { w: (n as Konva.Group).clipWidth(), h: (n as Konva.Group).clipHeight() };
  return { w: n.width(), h: n.height() };
}

/**
 * The Transformer resizes by setting scaleX/scaleY. We bake the scale into the
 * size on every `transform` event, so text reflows instead of stretching and a
 * frame's children keep their size, as in Figma.
 */
function bakeScale(n: Konva.Node) {
  const sx = n.scaleX(), sy = n.scaleY();
  if (sx === 1 && sy === 1) return;
  const { w, h } = sizeOf(n);
  const nw = Math.max(1, w * Math.abs(sx)), nh = Math.max(1, h * Math.abs(sy));
  n.scale({ x: 1, y: 1 });
  switch (n.getClassName()) {
    case 'Ellipse':
      (n as Konva.Ellipse).setAttrs({ radiusX: nw / 2, radiusY: nh / 2, offsetX: -nw / 2, offsetY: -nh / 2 });
      break;
    case 'Group': {
      const g = n as Konva.Group;
      g.clipWidth(nw);
      g.clipHeight(nh);
      g.findOne('.frame-bg')?.setAttrs({ width: nw, height: nh });
      break;
    }
    default:
      n.setAttrs({ width: nw, height: nh });
  }
}

const SelectionTransformer = memo(function SelectionTransformer({ trRef }: { trRef: RefObject<Konva.Transformer | null> }) {
  const selection = useEditor((s) => s.selection);
  const doc = useEditor((s) => s.doc);
  const dragging = useSession((s) => s.dragging);
  const editing = useSession((s) => s.editingTextId);
  // Like Figma, a selection only a few pixels big gets no handles: they would
  // cover it, and pressing it would resize instead of move.
  const bounds = useMemo(() => boundsOf(doc, selection), [doc, selection]);
  const small = useCamera((s) => !bounds || Math.min(bounds.w, bounds.h) * s.scale < 24);

  // Attach after the commit that mounted the Konva nodes (refs are set by then).
  useLayoutEffect(() => {
    const tr = trRef.current;
    if (!tr) return;
    const nodes = dragging || editing ? [] : selection
      .filter((id) => isEffectivelyVisible(doc, id) && !isEffectivelyLocked(doc, id))
      .map((id) => konvaNodes.get(id))
      .filter((n): n is Konva.Node => !!n);
    tr.nodes(nodes);
    tr.getLayer()?.batchDraw();
  }, [trRef, selection, doc, dragging, editing]);

  const onTransform = () => trRef.current?.nodes().forEach(bakeScale);
  const onTransformEnd = () => {
    const tr = trRef.current;
    if (!tr) return;
    const updates = tr.nodes().map((n) => {
      bakeScale(n);
      const { w, h } = sizeOf(n);
      return { id: n.id(), x: n.x(), y: n.y(), w, h, rotation: n.rotation() };
    });
    useEditor.getState().applyTransforms(updates);
  };

  return (
    <Transformer
      ref={trRef}
      flipEnabled={false}
      enabledAnchors={small ? [] : undefined}
      rotateEnabled={!small}
      keepRatio={false} // shift (shiftBehavior "default") keeps the aspect ratio
      ignoreStroke
      rotateAnchorOffset={20}
      rotationSnaps={[0, 45, 90, 135, 180, 225, 270, 315]}
      rotationSnapTolerance={3}
      anchorSize={8}
      anchorCornerRadius={2}
      borderStroke={ACCENT}
      anchorStroke={ACCENT}
      boundBoxFunc={(oldBox, newBox) => (Math.abs(newBox.width) < 1 || Math.abs(newBox.height) < 1 ? oldBox : newBox)}
      onTransform={onTransform}
      onTransformEnd={onTransformEnd}
    />
  );
});
