import { useEffect } from 'react';
import { boundsOf } from './model/doc';
import type { Tool } from './model/types';
import { useEditor } from './store/editor';
import { cameraToFit, useCamera, useSession } from './store/view';

const TOOL_KEYS: Record<string, Tool> = { v: 'select', r: 'rect', o: 'ellipse', t: 'text', f: 'frame' };

function isTyping(target: EventTarget | null) {
  const el = target as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
}

export function zoomToFit(viewport: { width: number; height: number }, ids?: string[]) {
  const { doc } = useEditor.getState();
  const b = boundsOf(doc, ids && ids.length ? ids : doc.root);
  if (b) useCamera.getState().setCamera(cameraToFit(b, viewport.width, viewport.height));
}

export function useShortcuts(getViewport: () => { width: number; height: number }) {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return;
      const ed = useEditor.getState();
      const mod = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();
      if (e.key === ' ') {
        if (!e.repeat) useSession.getState().set({ spaceDown: true });
        e.preventDefault();
        return;
      }
      if (mod) {
        const run: Record<string, () => void> = {
          z: () => (e.shiftKey ? ed.redo() : ed.undo()),
          y: ed.redo,
          c: ed.copy,
          x: ed.cut,
          v: ed.paste,
          d: ed.duplicate,
          a: ed.selectAll,
          ']': () => ed.reorder(1),
          '[': () => ed.reorder(-1),
        };
        if (run[key]) { e.preventDefault(); run[key](); }
        return;
      }
      if (e.key.startsWith('Arrow')) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
        if (d) ed.nudge(d[0], d[1]);
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); ed.deleteSelected(); return; }
      if (e.key === 'Escape') { ed.select([]); ed.setTool('select'); return; }
      if (e.shiftKey && e.code === 'Digit1') { zoomToFit(getViewport()); return; }
      if (e.shiftKey && e.code === 'Digit2') { zoomToFit(getViewport(), ed.selection); return; }
      if (!e.altKey && !e.shiftKey && TOOL_KEYS[key]) ed.setTool(TOOL_KEYS[key]);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === ' ') useSession.getState().set({ spaceDown: false });
    };
    const onBlur = () => useSession.getState().set({ spaceDown: false });
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, [getViewport]);
}
