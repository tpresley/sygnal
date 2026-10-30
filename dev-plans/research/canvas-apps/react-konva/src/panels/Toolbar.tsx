import type { Tool } from '../model/types';
import { exportSvg } from '../model/svg';
import { useEditor } from '../store/editor';
import { useCamera } from '../store/view';

const TOOLS: { tool: Tool; label: string; key: string }[] = [
  { tool: 'select', label: 'Move', key: 'V' },
  { tool: 'rect', label: 'Rectangle', key: 'R' },
  { tool: 'ellipse', label: 'Ellipse', key: 'O' },
  { tool: 'text', label: 'Text', key: 'T' },
  { tool: 'frame', label: 'Frame', key: 'F' },
];

function download(svg: string, name: string) {
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function Toolbar({ onStress, onFit }: { onStress(n: number): void; onFit(): void }) {
  const tool = useEditor((s) => s.tool);
  const canUndo = useEditor((s) => s.past.length > 0);
  const canRedo = useEditor((s) => s.future.length > 0);
  const hasSelection = useEditor((s) => s.selection.length > 0);
  const zoom = useCamera((s) => Math.round(s.scale * 100));
  const ed = useEditor.getState;

  return (
    <header className="toolbar">
      <div className="group" role="toolbar" aria-label="Tools">
        {TOOLS.map((t) => (
          <button key={t.tool} aria-pressed={tool === t.tool} title={`${t.label} (${t.key})`}
            onClick={() => ed().setTool(t.tool)}>
            {t.label} <kbd>{t.key}</kbd>
          </button>
        ))}
      </div>
      <div className="group">
        <button disabled={!canUndo} onClick={() => ed().undo()} title="Undo (⌘Z)">Undo</button>
        <button disabled={!canRedo} onClick={() => ed().redo()} title="Redo (⇧⌘Z)">Redo</button>
      </div>
      <div className="group">
        <button disabled={!hasSelection} onClick={() => { const { doc, selection } = ed(); download(exportSvg(doc, selection), 'selection.svg'); }}>
          Export selection
        </button>
        <button onClick={() => download(exportSvg(ed().doc), 'page.svg')}>Export page</button>
      </div>
      <div className="group">
        <span className="label">Stress</span>
        {[1000, 5000, 10000].map((n) => (
          <button key={n} onClick={() => onStress(n)}>{n / 1000}k</button>
        ))}
        <button onClick={() => onStress(0)}>Clear</button>
      </div>
      <button className="zoom" onClick={onFit} title="Zoom to fit (⇧1)" data-testid="zoom">{zoom}%</button>
    </header>
  );
}
