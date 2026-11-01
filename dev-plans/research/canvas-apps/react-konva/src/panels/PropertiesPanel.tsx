import { useState, type ReactNode } from 'react';
import type { NodePatch, SceneNode } from '../model/types';
import { useEditor } from '../store/editor';
import { useOverlay } from '../store/view';

type NumKey = 'x' | 'y' | 'w' | 'h' | 'rotation' | 'cornerRadius' | 'opacity' | 'strokeWidth';

const MIXED = Symbol('mixed');
function common<T>(nodes: SceneNode[], get: (n: SceneNode) => T): T | typeof MIXED {
  const first = get(nodes[0]);
  return nodes.every((n) => get(n) === first) ? first : MIXED;
}
const round = (v: number) => Math.round(v * 100) / 100;

/** A field that edits a draft and commits on Enter or blur (one undo step per edit). */
function NumberField({ label, value, onCommit, scale = 1, suffix }: {
  label: string; value: number | typeof MIXED; onCommit(v: number): void; scale?: number; suffix?: string;
}) {
  const shown = value === MIXED ? '' : String(round(value * scale));
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft === null) return;
    const v = Number(draft);
    setDraft(null);
    if (draft.trim() !== '' && Number.isFinite(v) && v / scale !== value) onCommit(v / scale);
  };
  return (
    <label className="field">
      <span>{label}</span>
      <input inputMode="decimal" value={draft ?? shown} placeholder={value === MIXED ? 'Mixed' : ''}
        onChange={(e) => setDraft(e.target.value)} onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          if (e.key === 'Escape') setDraft(null);
          if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            if (value === MIXED) return;
            const step = (e.shiftKey ? 10 : 1) * (e.key === 'ArrowUp' ? 1 : -1);
            onCommit((round(value * scale) + step) / scale);
          }
        }} />
      {suffix && <i>{suffix}</i>}
    </label>
  );
}

function ColorField({ label, value, onCommit }: { label: string; value: string | typeof MIXED; onCommit(v: string): void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const hex = value === MIXED ? '' : value;
  const commit = () => {
    if (draft !== null && /^#[0-9a-f]{6}$/i.test(draft) && draft !== value) onCommit(draft);
    setDraft(null);
  };
  return (
    <label className="field color">
      <span>{label}</span>
      <input type="color" value={/^#[0-9a-f]{6}$/i.test(hex) ? hex : '#000000'} onChange={(e) => onCommit(e.target.value)} />
      <input value={draft ?? hex} placeholder={value === MIXED ? 'Mixed' : ''} onChange={(e) => setDraft(e.target.value)}
        onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && commit()} />
    </label>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return <section><h3>{title}</h3><div className="grid">{children}</div></section>;
}

export function PropertiesPanel() {
  const doc = useEditor((s) => s.doc);
  const selection = useEditor((s) => s.selection);
  // live X/Y while a drag is in flight (the store only changes on drop)
  const delta = useOverlay((s) => s.dragDelta);
  const nodes = selection.map((id) => doc.nodes[id]).filter(Boolean);
  if (nodes.length === 0) {
    return <aside className="panel props" aria-label="Properties"><h2>Design</h2><p className="empty">Nothing selected</p></aside>;
  }
  const ed = useEditor.getState();
  const set = (patch: NodePatch) => ed.updateSelected(patch);
  const num = (k: NumKey) => common(nodes, (n) => n[k]);
  const live = (k: 'x' | 'y') => {
    const v = num(k);
    // top-level nodes move in world space, so the delta applies as is
    return v !== MIXED && delta && nodes.every((n) => !n.parentId) ? v + delta[k] : v;
  };
  const texts = nodes.filter((n) => n.type === 'text');

  return (
    <aside className="panel props" aria-label="Properties">
      <h2>Design <small>{nodes.length > 1 ? `${nodes.length} selected` : nodes[0].name}</small></h2>
      <Section title="Layout">
        <NumberField label="X" value={live('x')} onCommit={(v) => set({ x: v })} />
        <NumberField label="Y" value={live('y')} onCommit={(v) => set({ y: v })} />
        <NumberField label="W" value={num('w')} onCommit={(v) => set({ w: v })} />
        <NumberField label="H" value={num('h')} onCommit={(v) => set({ h: v })} />
        <NumberField label="↻" value={num('rotation')} onCommit={(v) => set({ rotation: v })} suffix="°" />
        <NumberField label="◜" value={num('cornerRadius')} onCommit={(v) => set({ cornerRadius: v })} />
      </Section>
      <Section title="Layer">
        <NumberField label="Opacity" value={num('opacity')} scale={100} onCommit={(v) => set({ opacity: v })} suffix="%" />
      </Section>
      <Section title="Fill">
        <ColorField label="Fill" value={common(nodes, (n) => n.fill)} onCommit={(v) => set({ fill: v })} />
      </Section>
      <Section title="Stroke">
        <ColorField label="Stroke" value={common(nodes, (n) => n.stroke)} onCommit={(v) => set({ stroke: v })} />
        <NumberField label="Width" value={num('strokeWidth')} onCommit={(v) => set({ strokeWidth: v })} />
      </Section>
      {texts.length > 0 && texts.length === nodes.length && (
        <Section title="Text">
          <NumberField label="Size" value={common(texts, (n) => (n.type === 'text' ? n.fontSize : 0))} onCommit={(v) => set({ fontSize: Math.max(1, v) })} />
        </Section>
      )}
    </aside>
  );
}
