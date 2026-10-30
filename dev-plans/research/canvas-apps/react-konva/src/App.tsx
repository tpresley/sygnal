import type Konva from 'konva';
import { useCallback, useEffect, useRef } from 'react';
import { installBench } from './bench';
import { CanvasStage } from './canvas/CanvasStage';
import { makeNode } from './model/doc';
import { stressDoc } from './model/stress';
import type { Doc, SceneNode } from './model/types';
import { LayersPanel } from './panels/LayersPanel';
import { PropertiesPanel } from './panels/PropertiesPanel';
import { Toolbar } from './panels/Toolbar';
import { useEditor } from './store/editor';
import { useCamera } from './store/view';
import { useShortcuts, zoomToFit } from './useShortcuts';

/** A small starter page so the app opens on something to play with. */
function demoDoc(): Doc {
  const frame = makeNode('frame', { x: 80, y: 80, w: 420, h: 300 }, { name: 'Card' }) as SceneNode & { children: string[] };
  const title = makeNode('text', { x: 24, y: 24, w: 300, h: 34 }, { text: 'Hello, canvas', fontSize: 28 });
  const pill = makeNode('rect', { x: 24, y: 220, w: 140, h: 48 }, { fill: '#0d99ff', cornerRadius: 24, name: 'Button' });
  const dot = makeNode('ellipse', { x: 320, y: 180, w: 72, h: 72 }, { fill: '#ffc700' });
  for (const c of [title, pill, dot]) { c.parentId = frame.id; frame.children.push(c.id); }
  const loose = makeNode('rect', { x: 580, y: 120, w: 160, h: 120 }, { fill: '#14ae5c', cornerRadius: 8 });
  const ring = makeNode('ellipse', { x: 600, y: 300, w: 120, h: 120 }, { fill: '#ffffff', stroke: '#f24822', strokeWidth: 4 });
  const nodes = Object.fromEntries([frame, title, pill, dot, loose, ring].map((n) => [n.id, n]));
  return { nodes, root: [frame.id, loose.id, ring.id] };
}

export function App() {
  const stageRef = useRef<Konva.Stage>(null);
  const getViewport = useCallback(() => {
    const s = stageRef.current;
    return { width: s?.width() ?? window.innerWidth, height: s?.height() ?? window.innerHeight };
  }, []);
  useShortcuts(getViewport);

  const loadStress = useCallback((n: number) => {
    useEditor.getState().loadDoc(n ? stressDoc(n) : { nodes: {}, root: [] });
    if (n) zoomToFit(getViewport());
    else useCamera.getState().setCamera({ x: 0, y: 0, scale: 1 });
  }, [getViewport]);

  useEffect(() => {
    if (useEditor.getState().doc.root.length === 0 && !new URLSearchParams(location.search).has('empty')) {
      useEditor.getState().loadDoc(demoDoc());
    }
    return installBench({ stageRef, loadStress });
  }, [loadStress]);

  return (
    <div className="app">
      <Toolbar onStress={loadStress} onFit={() => zoomToFit(getViewport())} />
      <LayersPanel />
      <CanvasStage stageRef={stageRef} />
      <PropertiesPanel />
    </div>
  );
}
