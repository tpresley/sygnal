// window.__canvasBench: the hook the perf scripts drive. Any implementation of
// the spec that exposes the same object can be measured by perf/run.mjs.
import type Konva from 'konva';
import type { RefObject } from 'react';
import { boundsOf, worldBounds } from './model/doc';
import { useEditor } from './store/editor';
import { worldToScreen } from './store/view';

export interface CanvasBench {
  version: 1;
  framework: string;
  /** Replaces the document with the stress layout of n shapes and zooms to fit; resolves once painted. */
  generate(n: number): Promise<void>;
  /** Selects the first `count` top-level shapes in document order (bottom first), or all of them. */
  select(count: number | 'all'): Promise<void>;
  /** Client (page) coordinates of a point on a selected shape: press there to drag the selection. */
  dragPoint(): { x: number; y: number };
  /** Client coordinates of the canvas element's centre. */
  canvasCenter(): { x: number; y: number };
  /** Number of shapes in the document. */
  count(): number;
  /** Resolves after the next frame has been drawn. */
  frame(): Promise<void>;
}

declare global {
  interface Window { __canvasBench?: CanvasBench }
}

const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));

export function installBench({ stageRef, loadStress }: { stageRef: RefObject<Konva.Stage | null>; loadStress(n: number): void }) {
  const containerRect = () => stageRef.current!.container().getBoundingClientRect();
  const bench: CanvasBench = {
    version: 1,
    framework: 'react-konva',
    async generate(n) {
      loadStress(n);
      await nextFrame();
    },
    async select(count) {
      const { doc, select } = useEditor.getState();
      select(count === 'all' ? [...doc.root] : doc.root.slice(0, count));
      await nextFrame();
    },
    dragPoint() {
      // the centre of the selected shape nearest the selection's centre: on a
      // shape, and away from any resize handle
      const { doc, selection } = useEditor.getState();
      const all = boundsOf(doc, selection)!;
      const cx = all.x + all.w / 2, cy = all.y + all.h / 2;
      let best = { x: cx, y: cy }, bestD = Infinity;
      for (const id of selection) {
        const b = worldBounds(doc, id);
        const c = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
        const d = (c.x - cx) ** 2 + (c.y - cy) ** 2;
        if (d < bestD) { bestD = d; best = c; }
      }
      const p = worldToScreen(best);
      const r = containerRect();
      return { x: r.left + p.x, y: r.top + p.y };
    },
    canvasCenter() {
      const r = containerRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    },
    count: () => Object.keys(useEditor.getState().doc.nodes).length,
    frame: nextFrame,
  };
  window.__canvasBench = bench;
  document.documentElement.dataset.benchReady = '1';
  return () => {
    delete window.__canvasBench;
    delete document.documentElement.dataset.benchReady;
  };
}
