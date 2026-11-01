// In-place text editing: a DOM <textarea> laid over the Konva text with the
// same transform (Konva has no editable text; this is the documented approach).
import Konva from 'konva';
import { useLayoutEffect, useRef } from 'react';
import { worldMatrix } from '../model/doc';
import { useEditor } from '../store/editor';
import { useCamera, useSession } from '../store/view';

const FONT = 'Inter, Arial, sans-serif';

export function measureTextHeight(text: string, fontSize: number, width: number): number {
  return new Konva.Text({ text: text || ' ', fontSize, width, lineHeight: 1.2, fontFamily: FONT }).height();
}

export function TextEditor() {
  const id = useSession((s) => s.editingTextId);
  const doc = useEditor((s) => s.doc);
  const cam = useCamera();
  const ref = useRef<HTMLTextAreaElement>(null);
  const node = id ? doc.nodes[id] : undefined;

  useLayoutEffect(() => {
    if (!ref.current) return;
    ref.current.focus();
    ref.current.select();
  }, [id]);

  if (!id || !node || node.type !== 'text') return null;
  const m = worldMatrix(doc, id);
  const s = cam.scale;
  const transform = `matrix(${m[0] * s}, ${m[1] * s}, ${m[2] * s}, ${m[3] * s}, ${m[4] * s + cam.x}, ${m[5] * s + cam.y})`;

  const finish = (save: boolean) => {
    const value = ref.current?.value ?? node.text;
    useSession.getState().set({ editingTextId: null });
    const editor = useEditor.getState();
    if (!save) return;
    if (value.trim() === '') {
      editor.select([id]);
      editor.deleteSelected();
    } else if (value !== node.text) {
      editor.updateNode(id, { text: value, h: measureTextHeight(value, node.fontSize, node.w) });
    }
  };

  return (
    <textarea
      key={id}
      ref={ref}
      className="text-editor"
      defaultValue={node.text}
      spellCheck={false}
      style={{
        transform, width: node.w, height: Math.max(node.h, node.fontSize * 1.2), fontSize: node.fontSize,
        color: node.fill, fontFamily: FONT, opacity: node.opacity,
      }}
      onBlur={() => finish(true)}
      onKeyDown={(e) => {
        e.stopPropagation(); // keep editor shortcuts (V, Delete, ⌘Z...) out of the textarea
        if (e.key === 'Escape' || (e.key === 'Enter' && (e.metaKey || e.ctrlKey))) e.currentTarget.blur();
      }}
      onInput={(e) => {
        const el = e.currentTarget;
        el.style.height = 'auto';
        el.style.height = `${el.scrollHeight}px`;
      }}
    />
  );
}
