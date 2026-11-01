// Pointer gestures on the canvas: select, drag with snapping, marquee, pan and
// draw. The per-frame part of a drag is imperative (Konva refs); React and the
// document store only see its start and its end.
import Konva from 'konva';
import { useEffect, useRef, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';
import { KonvaRenderer } from 'react-konva';
import {
  boundsOf, flattenTree, isEffectivelyVisible, subtree, topLevel, worldBounds,
} from '../model/doc';
import { rectContainsPoint, rectFromPoints, type Point, type Rect } from '../model/geometry';
import { clickSelect, frameAt, hitTest, marqueeHits } from '../model/selection';
import { buildSnapTargets, snapRect, type SnapTargets } from '../model/snapping';
import type { NodeType } from '../model/types';
import { CACHE_ENABLED, CACHE_MIN_NODES, cacheAtScreenResolution } from './bitmapCache';
import { useEditor } from '../store/editor';
import { screenToWorld, useCamera, useOverlay, useSession } from '../store/view';

const DRAG_THRESHOLD = 3; // screen px
const SNAP_DISTANCE = 6; // screen px

type Gesture =
  | { kind: 'pan'; last: Point }
  | { kind: 'press'; start: Point; startWorld: Point; ids: string[]; hit: string | null; wasSelected: boolean; shift: boolean }
  | { kind: 'drag'; startWorld: Point; ids: string[]; exclude: Set<string>; bounds: Rect; targets: SnapTargets; delta: Point }
  | { kind: 'marquee'; startWorld: Point; base: string[]; bounds: Map<string, Rect> }
  | { kind: 'create'; type: NodeType; startWorld: Point };

export interface CanvasRefs {
  container: RefObject<HTMLDivElement | null>;
  stage: RefObject<Konva.Stage | null>;
  dragGroup: RefObject<Konva.Group | null>;
  transformer: RefObject<Konva.Transformer | null>;
}

function localPoint(el: HTMLElement, e: { clientX: number; clientY: number }): Point {
  const r = el.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}

export function useCanvasGestures(refs: CanvasRefs) {
  const gesture = useRef<Gesture | null>(null);

  // wheel: pan, or zoom toward the cursor with ctrl/⌘ (trackpad pinch sends ctrlKey).
  // React's onWheel is passive, so preventDefault needs a native listener.
  useEffect(() => {
    const el = refs.container.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const cam = useCamera.getState();
      const unit = e.deltaMode === 1 ? 16 : 1;
      if (e.ctrlKey || e.metaKey) {
        const dy = Math.max(-50, Math.min(50, e.deltaY * unit));
        cam.zoomAt(localPoint(el, e), Math.exp(-dy * 0.01));
      } else if (e.shiftKey && e.deltaX === 0) {
        cam.panBy(-e.deltaY * unit, 0);
      } else {
        cam.panBy(-e.deltaX * unit, -e.deltaY * unit);
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [refs.container]);

  const isOnTransformer = (e: ReactPointerEvent): boolean => {
    const stage = refs.stage.current;
    const tr = refs.transformer.current;
    if (!stage || !tr || tr.nodes().length === 0) return false;
    stage.setPointersPositions(e.nativeEvent);
    const pos = stage.getPointerPosition();
    const hit = pos && tr.getLayer()?.getIntersection(pos);
    return !!hit && hit.findAncestor('Transformer') === tr;
  };

  function startDrag(g: Extract<Gesture, { kind: 'press' }>) {
    const { doc } = useEditor.getState();
    const ids = topLevel(doc, g.ids).filter((id) => !doc.nodes[id].locked);
    if (ids.length === 0) return null;
    // keep z-order inside the drag layer
    const order = new Map(flattenTree(doc).map((r, i) => [r.id, -i]));
    ids.sort((a, b) => order.get(a)! - order.get(b)!);
    const exclude = new Set<string>();
    for (const id of ids) subtree(doc, id).forEach((d) => exclude.add(d));
    // snap to every other visible node (a few ms at 10k, once per drag)
    const rects: Rect[] = [];
    for (const id in doc.nodes) {
      if (!exclude.has(id) && isEffectivelyVisible(doc, id)) rects.push(worldBounds(doc, id));
    }
    const bounds = boundsOf(doc, ids)!;
    // Moving the nodes to the drag layer must be committed before we cache and
    // move the drag group. react-dom's flushSync does not reach the Stage's
    // children: react-konva renders them with its own reconciler root.
    KonvaRenderer.flushSyncFromReconciler(() => useSession.getState().set({ dragging: new Set(ids) }));
    // a large selection is drawn once into a bitmap, then only translated
    const group = refs.dragGroup.current;
    if (CACHE_ENABLED && group && exclude.size >= CACHE_MIN_NODES) cacheAtScreenResolution(group, useCamera.getState().scale);
    useOverlay.getState().set({ dragBounds: bounds, dragDelta: { x: 0, y: 0 } });
    return {
      kind: 'drag', startWorld: g.startWorld, ids, exclude, bounds, targets: buildSnapTargets(rects), delta: { x: 0, y: 0 },
    } satisfies Gesture;
  }

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    const el = refs.container.current;
    if (!el || (e.button !== 0 && e.button !== 1)) return;
    if (useSession.getState().editingTextId) return; // the textarea's blur commits it
    if (e.button === 0 && isOnTransformer(e)) return; // Konva handles resize/rotate
    el.setPointerCapture(e.pointerId);
    const screen = localPoint(el, e);
    const world = screenToWorld(screen);
    const editor = useEditor.getState();

    if (e.button === 1 || useSession.getState().spaceDown) {
      gesture.current = { kind: 'pan', last: screen };
      useSession.getState().set({ panning: true });
      return;
    }
    if (editor.tool !== 'select') {
      gesture.current = { kind: 'create', type: editor.tool, startWorld: world };
      return;
    }
    const hit = hitTest(editor.doc, world);
    if (hit) {
      const wasSelected = editor.selection.includes(hit);
      const next = clickSelect(editor.selection, hit, e.shiftKey);
      editor.select(next);
      gesture.current = next.includes(hit)
        ? { kind: 'press', start: screen, startWorld: world, ids: next, hit, wasSelected, shift: e.shiftKey }
        : null;
      return;
    }
    // empty spot inside a multi-selection's box still drags the selection
    const selBounds = editor.selection.length > 1 ? boundsOf(editor.doc, editor.selection) : null;
    if (!e.shiftKey && selBounds && rectContainsPoint(selBounds, world)) {
      gesture.current = { kind: 'press', start: screen, startWorld: world, ids: editor.selection, hit: null, wasSelected: true, shift: false };
      return;
    }
    const base = e.shiftKey ? editor.selection : [];
    if (!e.shiftKey) editor.select([]);
    const bounds = new Map(editor.doc.root.map((id) => [id, worldBounds(editor.doc, id)]));
    gesture.current = { kind: 'marquee', startWorld: world, base, bounds };
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    const el = refs.container.current;
    if (!g || !el) return;
    const screen = localPoint(el, e);
    const world = screenToWorld(screen);
    switch (g.kind) {
      case 'pan':
        useCamera.getState().panBy(screen.x - g.last.x, screen.y - g.last.y);
        g.last = screen;
        return;
      case 'press':
        if (Math.hypot(screen.x - g.start.x, screen.y - g.start.y) < DRAG_THRESHOLD) return;
        gesture.current = startDrag(g);
        if (gesture.current) onPointerMove(e);
        return;
      case 'drag': {
        const raw = { x: world.x - g.startWorld.x, y: world.y - g.startWorld.y };
        const moved = { ...g.bounds, x: g.bounds.x + raw.x, y: g.bounds.y + raw.y };
        // ctrl/⌘ while dragging disables snapping, as in Figma
        const snap = e.ctrlKey || e.metaKey
          ? { dx: 0, dy: 0, guides: [] }
          : snapRect(moved, g.targets, SNAP_DISTANCE / useCamera.getState().scale);
        g.delta = { x: raw.x + snap.dx, y: raw.y + snap.dy };
        const group = refs.dragGroup.current;
        if (group) {
          group.position(g.delta);
          group.getLayer()?.batchDraw();
        }
        useOverlay.getState().set({ guides: snap.guides, dragDelta: g.delta });
        return;
      }
      case 'marquee': {
        const rect = rectFromPoints(g.startWorld, world);
        const { doc } = useEditor.getState();
        const hits = marqueeHits(doc, rect, g.bounds);
        useEditor.getState().select(g.base.length ? [...new Set([...g.base, ...hits])] : hits);
        useOverlay.getState().set({ marquee: rect });
        return;
      }
      case 'create': {
        let rect = rectFromPoints(g.startWorld, world);
        if (e.shiftKey) {
          const s = Math.max(rect.w, rect.h);
          rect = { x: world.x < g.startWorld.x ? g.startWorld.x - s : g.startWorld.x, y: world.y < g.startWorld.y ? g.startWorld.y - s : g.startWorld.y, w: s, h: s };
        }
        useOverlay.getState().set({ draft: rect });
        return;
      }
    }
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    const el = refs.container.current;
    gesture.current = null;
    if (!g || !el) return;
    if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
    const editor = useEditor.getState();
    const world = screenToWorld(localPoint(el, e));
    switch (g.kind) {
      case 'pan':
        useSession.getState().set({ panning: false });
        return;
      case 'press':
        // a plain click on an already-selected node narrows the selection to it
        if (g.hit && g.wasSelected && !g.shift) editor.select([g.hit]);
        return;
      case 'drag': {
        const drop = frameAt(editor.doc, world, g.exclude);
        editor.dropMove(g.ids, g.delta.x, g.delta.y, drop);
        refs.dragGroup.current?.clearCache();
        refs.dragGroup.current?.position({ x: 0, y: 0 });
        useSession.getState().set({ dragging: null });
        useOverlay.getState().set({ guides: [], dragDelta: null, dragBounds: null });
        return;
      }
      case 'marquee':
        useOverlay.getState().set({ marquee: null });
        return;
      case 'create': {
        const draft = useOverlay.getState().draft;
        useOverlay.getState().set({ draft: null });
        const small = !draft || draft.w < 2 || draft.h < 2;
        if (g.type === 'text') {
          const id = editor.createNode('text', { x: g.startWorld.x, y: g.startWorld.y, w: small ? 200 : draft!.w, h: 29 });
          useSession.getState().set({ editingTextId: id });
        } else {
          const size = g.type === 'frame' ? 200 : 100;
          editor.createNode(g.type, small ? { x: g.startWorld.x, y: g.startWorld.y, w: size, h: size } : draft!);
        }
        editor.setTool('select');
        return;
      }
    }
  };

  const onDoubleClick = (e: ReactMouseEvent<HTMLDivElement>) => {
    const el = refs.container.current;
    if (!el) return;
    const { doc } = useEditor.getState();
    const hit = hitTest(doc, screenToWorld(localPoint(el, e)));
    if (hit && doc.nodes[hit].type === 'text') {
      useEditor.getState().select([hit]);
      useSession.getState().set({ editingTextId: hit });
    }
  };

  return { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onPointerUp, onDoubleClick };
}
