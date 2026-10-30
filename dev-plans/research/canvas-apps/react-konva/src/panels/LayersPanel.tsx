// Layers tree in the DOM, virtualized (10k rows would otherwise be 10k DOM nodes).
import { useVirtualizer } from '@tanstack/react-virtual';
import { memo, useMemo, useRef, useState, type DragEvent } from 'react';
import { childIds, flattenTree } from '../model/doc';
import { useEditor } from '../store/editor';

const ROW = 28;
type Drop = { id: string; where: 'above' | 'below' | 'inside' };
const ICON = { rect: '▭', ellipse: '○', text: 'T', frame: '#' } as const;

/** Selection as a Set, memoized per selection array so rows can test membership in O(1). */
const setCache = new WeakMap<readonly string[], Set<string>>();
const selectionSet = (sel: readonly string[]) => {
  let s = setCache.get(sel);
  if (!s) setCache.set(sel, (s = new Set(sel)));
  return s;
};

export function LayersPanel() {
  const doc = useEditor((s) => s.doc);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  const [drop, setDrop] = useState<Drop | null>(null);
  const dragId = useRef<string | null>(null);
  // Recomputed per committed edit, never per drag frame.
  const rows = useMemo(() => flattenTree(doc, collapsed), [doc, collapsed]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({ count: rows.length, getScrollElement: () => scrollRef.current, estimateSize: () => ROW, overscan: 10 });

  const toggleCollapsed = (id: string) =>
    setCollapsed((c) => { const n = new Set(c); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const onDragOver = (e: DragEvent, id: string) => {
    if (!dragId.current || dragId.current === id) return;
    e.preventDefault();
    const r = e.currentTarget.getBoundingClientRect();
    const f = (e.clientY - r.top) / r.height;
    const isFrame = useEditor.getState().doc.nodes[id]?.type === 'frame';
    const where = isFrame && f > 0.25 && f < 0.75 ? 'inside' : f < 0.5 ? 'above' : 'below';
    if (drop?.id !== id || drop.where !== where) setDrop({ id, where });
  };
  const onDrop = () => {
    const src = dragId.current;
    dragId.current = null;
    setDrop(null);
    if (!src || !drop) return;
    const ed = useEditor.getState();
    const target = ed.doc.nodes[drop.id];
    if (drop.where === 'inside') return ed.moveLayer(src, drop.id, Infinity);
    // the panel lists topmost first, so "above" in the list means a higher z index
    const sibs = childIds(ed.doc, target.parentId).filter((s) => s !== src);
    const i = sibs.indexOf(drop.id);
    ed.moveLayer(src, target.parentId, drop.where === 'above' ? i + 1 : i);
  };

  return (
    <aside className="panel layers" aria-label="Layers">
      <h2>Layers <small>{Object.keys(doc.nodes).length}</small></h2>
      <div ref={scrollRef} className="scroll" onDragLeave={(e) => { if (e.currentTarget === e.target) setDrop(null); }}>
        <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
          {virtualizer.getVirtualItems().map((v) => {
            const row = rows[v.index];
            return (
              <LayerRow key={row.id} id={row.id} depth={row.depth} top={v.start}
                collapsed={collapsed.has(row.id)} onToggle={toggleCollapsed}
                drop={drop?.id === row.id ? drop.where : null}
                onDragStart={(id) => (dragId.current = id)} onDragOver={onDragOver} onDrop={onDrop} />
            );
          })}
        </div>
      </div>
    </aside>
  );
}

interface RowProps {
  id: string; depth: number; top: number; collapsed: boolean; drop: Drop['where'] | null;
  onToggle(id: string): void; onDragStart(id: string): void; onDragOver(e: DragEvent, id: string): void; onDrop(): void;
}

const LayerRow = memo(function LayerRow({ id, depth, top, collapsed, drop, onToggle, onDragStart, onDragOver, onDrop }: RowProps) {
  const node = useEditor((s) => s.doc.nodes[id]);
  const selected = useEditor((s) => selectionSet(s.selection).has(id));
  const [renaming, setRenaming] = useState(false);
  if (!node) return null;
  const ed = useEditor.getState;

  return (
    <div
      className={`row${selected ? ' selected' : ''}${node.visible ? '' : ' hidden'}${drop ? ` drop-${drop}` : ''}`}
      style={{ transform: `translateY(${top}px)`, paddingLeft: 8 + depth * 14 }}
      draggable={!renaming}
      onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; onDragStart(id); }}
      onDragOver={(e) => onDragOver(e, id)}
      onDrop={(e) => { e.preventDefault(); onDrop(); }}
      onClick={(e) => {
        const { selection } = ed();
        ed().select(e.shiftKey ? (selection.includes(id) ? selection.filter((s) => s !== id) : [...selection, id]) : [id]);
      }}
      data-layer-id={id}
    >
      {node.type === 'frame'
        ? <button className="twisty" aria-label={collapsed ? 'Expand' : 'Collapse'} onClick={(e) => { e.stopPropagation(); onToggle(id); }}>{collapsed ? '▸' : '▾'}</button>
        : <span className="twisty" />}
      <span className="icon">{ICON[node.type]}</span>
      {renaming ? (
        <input className="rename" defaultValue={node.name} autoFocus onFocus={(e) => e.currentTarget.select()}
          onClick={(e) => e.stopPropagation()}
          onBlur={(e) => { setRenaming(false); const v = e.currentTarget.value.trim(); if (v && v !== node.name) ed().updateNode(id, { name: v }); }}
          onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') { e.currentTarget.value = node.name; e.currentTarget.blur(); } }} />
      ) : (
        <span className="name" onDoubleClick={() => setRenaming(true)}>{node.name}</span>
      )}
      <button className={`toggle${node.locked ? ' on' : ''}`} aria-label={node.locked ? 'Unlock' : 'Lock'} title="Lock"
        onClick={(e) => { e.stopPropagation(); ed().updateNode(id, { locked: !node.locked }); }}>{node.locked ? '🔒' : '🔓'}</button>
      <button className={`toggle${node.visible ? '' : ' on'}`} aria-label={node.visible ? 'Hide' : 'Show'} title="Hide"
        onClick={(e) => { e.stopPropagation(); ed().updateNode(id, { visible: !node.visible }); }}>{node.visible ? '👁' : '—'}</button>
    </div>
  );
});
