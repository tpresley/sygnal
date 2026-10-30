/** Nodes (paint.ts's vocabulary) → an SVG document string: what the canvas paints, as SVG (`exportSVG`). */
import {union, type AABB} from './geometry'
import {indexOf, type Node} from './paint'

const esc = (s: any) => String(s).replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'} as any)[c])
const r = (n: number) => Math.round(n * 100) / 100

function style(n: Node, frame = false) {
  const fill = n.fill ?? (n.type == 'text' ? '#000' : frame ? '#fff' : 'none')
  let s = ` fill="${esc(fill)}"`
  if (n.stroke && n.stroke != 'none' && (n.strokeWidth ?? 1) > 0) s += ` stroke="${esc(n.stroke)}" stroke-width="${n.strokeWidth ?? 1}"`
  if (n.opacity != null && n.opacity != 1) s += ` opacity="${n.opacity}"`
  if (n.rotation) s += ` transform="rotate(${r(n.rotation)} ${r(n.x + n.width / 2)} ${r(n.y + n.height / 2)})"`
  return s
}

function one(n: Node): string {
  const s = style(n, n.type == 'frame')
  switch (n.type) {
    case 'ellipse': return `<ellipse cx="${r(n.x + n.width / 2)}" cy="${r(n.y + n.height / 2)}" rx="${r(n.width / 2)}" ry="${r(n.height / 2)}"${s}/>`
    case 'text': {
      const size = n.fontSize || 16
      const tspans = String(n.text ?? '').split('\n').map((l, i) => `<tspan x="${r(n.x)}" dy="${i ? size * 1.25 : 0}">${esc(l)}</tspan>`).join('')
      return `<text x="${r(n.x)}" y="${r(n.y + size * 0.12)}" dominant-baseline="hanging" font-size="${size}" font-family="${esc(n.fontFamily || 'Inter, system-ui, sans-serif')}"${n.fontWeight ? ` font-weight="${n.fontWeight}"` : ''}${s}>${tspans}</text>`
    }
    case 'line': return `<line x1="${n.x1}" y1="${n.y1}" x2="${n.x2}" y2="${n.y2}" stroke="${esc(n.stroke || '#000')}" stroke-width="${n.strokeWidth ?? 1}"/>`
    case 'path': return `<path d="${esc(n.d)}"${s}/>`
    default: return `<rect x="${r(n.x)}" y="${r(n.y)}" width="${r(n.width)}" height="${r(n.height)}"${n.radius ? ` rx="${n.radius}"` : ''}${s}/>`
  }
}

/**
 * `items` in paint order; `ids`: only these (and their descendants), else all. Frames clip their
 * children (a clipPath per frame), as on the canvas.
 */
export function exportSVG(items: Node[], ids?: any[] | null, pad = 0): string {
  const idx = indexOf(items)
  let keep = items.filter(n => !n.hidden)
  if (ids) {
    const want = new Set(ids)
    const inside = (n: Node): boolean => want.has(n.id) || (n.parent != null && !!idx.get(n.parent) && inside(idx.get(n.parent)!))
    keep = keep.filter(inside)
  }
  const b: AABB = union(keep.filter(n => n.type != 'line' && n.type != 'path') as any) || {x0: 0, y0: 0, x1: 0, y1: 0}
  const x = b.x0 - pad, y = b.y0 - pad, w = b.x1 - b.x0 + pad * 2, h = b.y1 - b.y0 + pad * 2
  const clips: string[] = [], body: string[] = []
  const kids = new Map<any, Node[]>()
  for (const n of keep) {
    const p = n.parent != null && keep.includes(idx.get(n.parent)!) ? n.parent : null
    if (!kids.has(p)) kids.set(p, [])
    kids.get(p)!.push(n)
  }
  const emit = (n: Node) => {
    body.push(one(n))
    const c = kids.get(n.id)
    if (n.type == 'frame' && c?.length) {
      const cid = `clip-${String(n.id).replace(/[^\w-]/g, '_')}`
      clips.push(`<clipPath id="${cid}"><rect x="${r(n.x)}" y="${r(n.y)}" width="${r(n.width)}" height="${r(n.height)}"${n.rotation ? ` transform="rotate(${r(n.rotation)} ${r(n.x + n.width / 2)} ${r(n.y + n.height / 2)})"` : ''}/></clipPath>`)
      body.push(`<g clip-path="url(#${cid})">`)
      c.forEach(emit)
      body.push('</g>')
    }
  }
  ;(kids.get(null) || []).forEach(emit)
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${r(w)}" height="${r(h)}" viewBox="${r(x)} ${r(y)} ${r(w)} ${r(h)}">` +
    (clips.length ? `<defs>${clips.join('')}</defs>` : '') + body.join('') + '</svg>'
}
