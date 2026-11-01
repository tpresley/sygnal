// SVG export straight from the document model (not from Konva), so it is
// testable in Node and resolution independent.
import { boundsOf, parentMatrix, topLevel } from './doc';
import type { Mat } from './geometry';
import type { Doc, SceneNode } from './types';

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const num = (v: number) => String(Math.round(v * 1000) / 1000);
const matrix = (m: Mat) => `matrix(${m.map(num).join(' ')})`;

function paint(n: SceneNode): string {
  const stroke = n.strokeWidth > 0 ? ` stroke="${esc(n.stroke)}" stroke-width="${num(n.strokeWidth)}"` : '';
  const opacity = n.opacity < 1 ? ` opacity="${num(n.opacity)}"` : '';
  return `fill="${esc(n.fill)}"${stroke}${opacity}`;
}

function transform(n: SceneNode): string {
  const t = n.x !== 0 || n.y !== 0 ? `translate(${num(n.x)} ${num(n.y)})` : '';
  const r = n.rotation ? ` rotate(${num(n.rotation)})` : '';
  return t || r ? ` transform="${(t + r).trim()}"` : '';
}

function nodeSvg(doc: Doc, id: string, indent: string): string {
  const n = doc.nodes[id];
  if (!n || !n.visible) return '';
  switch (n.type) {
    case 'rect': {
      const rx = n.cornerRadius ? ` rx="${num(n.cornerRadius)}"` : '';
      return `${indent}<rect${transform(n)} width="${num(n.w)}" height="${num(n.h)}"${rx} ${paint(n)}/>\n`;
    }
    case 'ellipse':
      return `${indent}<ellipse${transform(n)} cx="${num(n.w / 2)}" cy="${num(n.h / 2)}" rx="${num(n.w / 2)}" ry="${num(n.h / 2)}" ${paint(n)}/>\n`;
    case 'text': {
      const lines = n.text.split('\n');
      const tspans = lines
        .map((l, i) => `<tspan x="0" dy="${i === 0 ? num(n.fontSize) : num(n.fontSize * 1.2)}">${esc(l)}</tspan>`)
        .join('');
      return `${indent}<text${transform(n)} font-family="Inter, Arial, sans-serif" font-size="${num(n.fontSize)}" ${paint(n)}>${tspans}</text>\n`;
    }
    case 'frame': {
      const clip = `clip-${n.id}`;
      const rx = n.cornerRadius ? ` rx="${num(n.cornerRadius)}"` : '';
      const opacity = n.opacity < 1 ? ` opacity="${num(n.opacity)}"` : '';
      const stroke = n.strokeWidth > 0 ? ` stroke="${esc(n.stroke)}" stroke-width="${num(n.strokeWidth)}"` : '';
      let s = `${indent}<g${transform(n)}${opacity} data-name="${esc(n.name)}">\n`;
      s += `${indent}  <clipPath id="${clip}"><rect width="${num(n.w)}" height="${num(n.h)}"${rx}/></clipPath>\n`;
      s += `${indent}  <rect width="${num(n.w)}" height="${num(n.h)}"${rx} fill="${esc(n.fill)}"${stroke}/>\n`;
      s += `${indent}  <g clip-path="url(#${clip})">\n`;
      for (const c of n.children) s += nodeSvg(doc, c, indent + '    ');
      s += `${indent}  </g>\n${indent}</g>\n`;
      return s;
    }
  }
}

/** Exports the given nodes (default: the whole page) cropped to their bounds. */
export function exportSvg(doc: Doc, ids?: readonly string[], padding = 0): string {
  const roots = ids && ids.length ? topLevel(doc, ids) : [...doc.root];
  const visible = roots.filter((id) => doc.nodes[id]?.visible);
  const b = boundsOf(doc, visible) ?? { x: 0, y: 0, w: 0, h: 0 };
  const x = b.x - padding, y = b.y - padding, w = b.w + padding * 2, h = b.h + padding * 2;
  let body = '';
  for (const id of visible) {
    const n = doc.nodes[id];
    // nodes inside frames keep their ancestors' transform
    const pm = n.parentId ? parentMatrix(doc, id) : null;
    const inner = nodeSvg(doc, id, pm ? '    ' : '  ');
    body += pm ? `  <g transform="${matrix(pm)}">\n${inner}  </g>\n` : inner;
  }
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${num(w)}" height="${num(h)}" viewBox="${num(x)} ${num(y)} ${num(w)} ${num(h)}">\n` +
    body +
    `</svg>\n`
  );
}
