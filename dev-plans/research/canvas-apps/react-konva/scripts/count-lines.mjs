// Non-blank, non-comment lines per concern (the README table).
import { readFileSync } from 'node:fs';

const concerns = {
  'State (model + stores)': ['src/model/types.ts', 'src/model/geometry.ts', 'src/model/doc.ts', 'src/store/view.ts', 'src/model/stress.ts'],
  'Undo + editing commands (store)': ['src/store/editor.ts'],
  'Canvas rendering (Konva)': ['src/canvas/CanvasStage.tsx', 'src/canvas/Layers.tsx', 'src/canvas/NodeView.tsx', 'src/canvas/registry.ts', 'src/canvas/bitmapCache.ts'],
  'Interactions (pointer, snapping, hit testing, text editing, shortcuts)': ['src/canvas/useCanvasGestures.ts', 'src/model/selection.ts', 'src/model/snapping.ts', 'src/canvas/TextEditor.tsx', 'src/useShortcuts.ts'],
  'Panels (toolbar, layers, properties)': ['src/panels/Toolbar.tsx', 'src/panels/LayersPanel.tsx', 'src/panels/PropertiesPanel.tsx'],
  'Export (SVG)': ['src/model/svg.ts'],
  'App shell + bench hook': ['src/App.tsx', 'src/main.tsx', 'src/bench.ts', 'src/styles.css'],
};

function count(file) {
  let inBlock = false, n = 0;
  for (const raw of readFileSync(file, 'utf8').split('\n')) {
    const line = raw.trim();
    if (inBlock) { if (line.includes('*/')) inBlock = false; continue; }
    if (!line || line.startsWith('//')) continue;
    if (line.startsWith('/*')) { if (!line.includes('*/')) inBlock = true; continue; }
    n++;
  }
  return n;
}

let total = 0;
console.log('| Concern | Files | Lines |\n|---|---|---:|');
for (const [name, files] of Object.entries(concerns)) {
  const n = files.reduce((a, f) => a + count(f), 0);
  total += n;
  console.log(`| ${name} | ${files.map((f) => '`' + f.replace('src/', '') + '`').join(', ')} | ${n} |`);
}
console.log(`| **Total app** | | **${total}** |`);
const tests = ['test/helpers.ts', 'test/selection.test.ts', 'test/snapping.test.ts', 'test/history.test.ts', 'test/frames.test.ts', 'test/export.test.ts'];
console.log(`| Tests | \`test/*.ts\` | ${tests.reduce((a, f) => a + count(f), 0)} |`);
console.log(`| Perf script | \`perf/run.mjs\` | ${count('perf/run.mjs')} |`);
