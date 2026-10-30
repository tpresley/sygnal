import type Konva from 'konva';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Stage } from 'react-konva';
import { useEditor } from '../store/editor';
import { useCamera, useSession } from '../store/view';
import { CACHE_ENABLED, CACHE_MIN_NODES, cacheAtScreenResolution } from './bitmapCache';
import { DragLayer, OverlayLayer, StaticLayer } from './Layers';
import { TextEditor } from './TextEditor';
import { useCanvasGestures } from './useCanvasGestures';

function useElementSize(ref: React.RefObject<HTMLElement | null>) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setSize({ width: Math.round(width), height: Math.round(height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return size;
}

/**
 * While the camera moves, blit a bitmap of the page instead of redrawing every
 * shape per wheel event; redraw crisp once the gesture has been idle for 150 ms.
 * Zooming shows the bitmap scaled (slightly soft) until then, like tiled editors.
 */
function useCameraGestureCache(content: React.RefObject<Konva.Group | null>) {
  useEffect(() => {
    if (!CACHE_ENABLED) return;
    let cached = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const release = () => {
      clearTimeout(timer);
      if (!cached) return;
      cached = false;
      content.current?.clearCache();
      content.current?.getLayer()?.batchDraw();
    };
    const unsubCamera = useCamera.subscribe((_cam, prev) => {
      const g = content.current;
      if (!g) return;
      if (!cached && !useSession.getState().dragging && Object.keys(useEditor.getState().doc.nodes).length >= CACHE_MIN_NODES) {
        cached = cacheAtScreenResolution(g, prev.scale);
      }
      clearTimeout(timer);
      if (cached) timer = setTimeout(release, 150);
    });
    // an edit during the gesture must not be hidden behind a stale bitmap
    const unsubDoc = useEditor.subscribe((s, prev) => { if (s.doc !== prev.doc) release(); });
    return () => { unsubCamera(); unsubDoc(); release(); };
  }, [content]);
}

export function CanvasStage({ stageRef }: { stageRef: React.RefObject<Konva.Stage | null> }) {
  const container = useRef<HTMLDivElement>(null);
  const dragGroup = useRef<Konva.Group>(null);
  const transformer = useRef<Konva.Transformer>(null);
  const content = useRef<Konva.Group>(null);
  useCameraGestureCache(content);
  const { width, height } = useElementSize(container);
  const x = useCamera((s) => s.x);
  const y = useCamera((s) => s.y);
  const scale = useCamera((s) => s.scale);
  const tool = useEditor((s) => s.tool);
  const spaceDown = useSession((s) => s.spaceDown);
  const panning = useSession((s) => s.panning);
  const handlers = useCanvasGestures({ container, stage: stageRef, dragGroup, transformer });

  const cursor = panning ? 'grabbing' : spaceDown ? 'grab' : tool === 'text' ? 'text' : tool !== 'select' ? 'crosshair' : 'default';
  return (
    <div ref={container} className="canvas" style={{ cursor }} data-testid="canvas" {...handlers}>
      {width > 0 && (
        // The layers are memoized children without props: a camera change
        // re-renders only <Stage> itself, and Konva redraws the layers.
        <Stage ref={stageRef} width={width} height={height} x={x} y={y} scaleX={scale} scaleY={scale}>
          <StaticLayer contentRef={content} />
          <DragLayer groupRef={dragGroup} />
          <OverlayLayer trRef={transformer} />
        </Stage>
      )}
      <TextEditor />
    </div>
  );
}
