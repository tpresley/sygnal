/** Nodes (paint.ts's vocabulary) → an SVG document string: what the canvas paints, as SVG (`exportSVG`). */
import {union, type AABB} from './geometry'
import {indexOf, sized, textLayout, type Node} from './paint'
import {imageOf, natural, placement} from './image'

const esc = (s: any) => String(s).replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'} as any)[c])
const r = (n: number) => Math.round(n * 100) / 100

function style(n: Node, frame = false) {
  const fill = n.fill ?? (n.type == 'text' ? '#000' : frame ? '#fff' : 'none')
  let s = ` fill="${esc(fill)}"`
  if (n.stroke && n.stroke != 'none' && (n.strokeWidth ?? 1) > 0) s += ` stroke="${esc(n.stroke)}" stroke-width="${n.strokeWidth ?? 1}"`
  if (n.opacity != null && n.opacity != 1) s += ` opacity="${n.opacity}"`
  if (n.rotation) { const b = sized(n); s += ` transform="rotate(${r(n.rotation)} ${r(n.x + b.width / 2)} ${r(n.y + b.height / 2)})"` }
  return s
}

function one(n: Node): string {
  const s = style(n, n.type == 'frame')
  switch (n.type) {
    case 'ellipse': return `<ellipse cx="${r(n.x + n.width / 2)}" cy="${r(n.y + n.height / 2)}" rx="${r(n.width / 2)}" ry="${r(n.height / 2)}"${s}/>`
    case 'text': {
      // the canvas's lines (wrapped, cut), one tspan each, aligned in the box
      const size = n.fontSize || 16, L = textLayout(n), a = n.align, b = sized(n)
      const x = r(n.x + (a == 'center' ? b.width / 2 : a == 'right' ? b.width : 0))
      const tspans = L.lines.map((l, i) => `<tspan x="${x}" dy="${i ? r(L.lineHeight) : 0}">${esc(l)}</tspan>`).join('')
      return `<text x="${x}" y="${r(n.y + size * 0.12 + (L.lineHeight - size * 1.25) / 2)}" dominant-baseline="hanging"${a == 'center' ? ' text-anchor="middle"' : a == 'right' ? ' text-anchor="end"' : ''} font-size="${size}" font-family="${esc(n.fontFamily || 'Inter, system-ui, sans-serif')}"${n.fontWeight ? ` font-weight="${n.fontWeight}"` : ''}${n.text && /^\s|\s\s|\s$/m.test(n.text) ? ' xml:space="preserve"' : ''}${s}>${tspans}</text>`
    }
    case 'image': return image(n)
    case 'line': return `<line x1="${n.x1}" y1="${n.y1}" x2="${n.x2}" y2="${n.y2}" stroke="${esc(n.stroke || '#000')}" stroke-width="${n.strokeWidth ?? 1}"/>`
    case 'path': return `<path d="${esc(n.d)}"${s}/>`
    default: return `<rect x="${r(n.x)}" y="${r(n.y)}" width="${r(n.width)}" height="${r(n.height)}"${n.radius ? ` rx="${n.radius}"` : ''}${s}/>`
  }
}

// an image source's URL: its src, a loaded element's, a canvas's pixels (when not tainted)
function hrefOf(n: Node): string {
  if (n.src && !n.image) return n.src
  const i = n.image
  if (i?.currentSrc || i?.src) return i.currentSrc || i.src
  try { return i?.toDataURL?.() || '' } catch (_) { return '' }
}

/**
 * an image: the crop fitted into its box as on the canvas (a nested <svg> whose viewBox is the
 * crop); before it has loaded (its size unknown), the whole image with SVG's own fit
 */
function image(n: Node): string {
  const href = hrefOf(n), b = sized(n)
  if (!href) return ''
  const cx = n.x + b.width / 2, cy = n.y + b.height / 2
  const t = [n.rotation ? `rotate(${r(n.rotation)} ${r(cx)} ${r(cy)})` : '', n.flipX || n.flipY ? `matrix(${n.flipX ? -1 : 1} 0 0 ${n.flipY ? -1 : 1} ${n.flipX ? r(2 * cx) : 0} ${n.flipY ? r(2 * cy) : 0})` : ''].filter(Boolean).join(' ')
  const g = (body: string) => t || (n.opacity != null && n.opacity != 1) ? `<g${t ? ` transform="${t}"` : ''}${n.opacity != null && n.opacity != 1 ? ` opacity="${n.opacity}"` : ''}>${body}</g>` : body
  const pix = n.smoothing === false ? ' style="image-rendering:pixelated"' : ''
  const img = imageOf(n), p = img && placement(n, img)
  if (!p) {
    const fit = n.fit == 'contain' || n.fit == 'scale-down' ? 'xMidYMid meet' : n.fit == 'cover' || n.fit == 'none' ? 'xMidYMid slice' : 'none'
    return g(`<image href="${esc(href)}" x="${r(n.x)}" y="${r(n.y)}" width="${r(b.width)}" height="${r(b.height)}" preserveAspectRatio="${fit}"${pix}/>`)
  }
  const [W, H] = natural(img)
  return g(`<svg x="${r(p.dx)}" y="${r(p.dy)}" width="${r(p.dw)}" height="${r(p.dh)}" viewBox="${r(p.sx)} ${r(p.sy)} ${r(p.sw)} ${r(p.sh)}" preserveAspectRatio="none"><image href="${esc(href)}" width="${W}" height="${H}"${pix}/></svg>`)
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
  const b: AABB = union(keep.filter(n => n.type != 'line' && n.type != 'path').map(sized) as any) || {x0: 0, y0: 0, x1: 0, y1: 0}
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
