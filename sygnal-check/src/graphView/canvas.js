/**
 * The canvas renderer (PLAN-10 V-4, D536): used instead of SVG only when more than CANVAS_NODES
 * (groups.js, ~400) nodes would be drawn, which happens when someone opens every group of a large
 * app. SVG panning drops frames there (S-1 §3: 100 ms per frame at 500 cards, 1.75 s at 2,000);
 * the canvas repaints only what is on screen and draws text only where it is legible.
 *
 *   paintCanvas(ctx, scene, view, o)
 *     ctx    a 2D context (the caller sizes the canvas and sets the device-pixel transform)
 *     scene  { P, L, routes }: the projection, its layout, edgePaths() output (each route may carry
 *            a cached `path2d`, made here on first use)
 *     view   { x, y, k, width, height }
 *     o      { colors: { name → css colour }, far: bool (semantic zoom), hl: Set | null (drawn ids
 *            to keep bright), hlEdge: (route) → bool, selected: id | null, hidden: { event, context,
 *            parent } (overlays switched off) }
 *   hitNode(scene, view, x, y) → the drawn node at canvas point (x, y), or null
 *
 * Pure apart from the context it is given: no DOM, no imports (html.js inlines it; see model.js).
 */

const label = (s, n) => s.length > n ? s.slice(0, n - 1) + '…' : s

export function paintCanvas(ctx, scene, view, o = {}) {
  const { P, L, routes } = scene
  const C = o.colors || {}
  const far = !!o.far
  ctx.clearRect(0, 0, view.width, view.height)
  ctx.save()
  ctx.translate(view.x, view.y)
  ctx.scale(view.k, view.k)
  const vx0 = -view.x / view.k, vy0 = -view.y / view.k, vx1 = vx0 + view.width / view.k, vy1 = vy0 + view.height / view.k
  const onScreen = (x, y, w, h) => x + w >= vx0 && x <= vx1 && y + h >= vy0 && y <= vy1
  // group boxes
  ctx.lineWidth = 1.5 / Math.max(view.k, 0.25)
  for (const b of L.clusters) {
    if (!onScreen(b.x, b.y, b.w, b.h)) continue
    ctx.strokeStyle = C.line
    ctx.strokeRect(b.x, b.y, b.w, b.h)
    ctx.fillStyle = far ? C.ink : C.muted
    ctx.textAlign = far ? 'center' : 'left'
    if (far) { ctx.font = `700 ${Math.round(18 / view.k)}px system-ui, sans-serif`; ctx.fillText(b.key.split('/').pop() || b.key, b.x + b.w / 2, b.y + b.h / 2) }
    else if (view.k > 0.3) { ctx.font = '12px ui-monospace, Menlo, monospace'; ctx.fillText(b.key + '/', b.x + 14, b.y + 22) }
  }
  ctx.textAlign = 'left'
  // edges
  for (const r of routes) {
    const overlay = r.cls === 'event' || r.cls === 'context' || r.cls === 'parent'
    if (overlay && (far || o.hidden?.[r.cls])) continue
    const a = L.pos.get(r.from), b = L.pos.get(r.to)
    if (!a || !b) continue
    if (!onScreen(Math.min(a.x, b.x) - 120, Math.min(a.y, b.y) - 60, Math.abs(a.x - b.x) + a.w + 240, Math.abs(a.y - b.y) + a.h + 120)) continue
    const on = !o.hl || (o.hlEdge ? o.hlEdge(r) : o.hl.has(r.from) && o.hl.has(r.to))
    ctx.globalAlpha = on ? (overlay ? 0.5 : 1) : 0.07
    ctx.strokeStyle = r.cls === 'event' ? C.ev : r.cls === 'context' ? C.ctx : r.cls === 'parent' ? C.par : r.cls === 'collection' ? C.coll : r.cls === 'switchable' ? C.switch : C.edge
    const n = r.edge?.count ?? 1
    ctx.lineWidth = Math.min(8, 1.5 + (n > 1 ? Math.log2(n) * 1.2 : 0)) * (on && o.hl ? 1.4 : 1)
    if (!r.path2d) r.path2d = new Path2D(r.d)
    ctx.stroke(r.path2d)
  }
  ctx.globalAlpha = 1
  // nodes
  for (const n of P.nodes) {
    const p = L.pos.get(n.id)
    if (!p || !onScreen(p.x, p.y, p.w, p.h)) continue
    ctx.globalAlpha = !o.hl || o.hl.has(n.id) ? (n.dim ? 0.5 : 1) : 0.2
    const c = n.comp
    const worst = c ? (c.diagnostics.some(d => d.severity === 'error') ? 'error' : c.diagnostics.some(d => d.severity === 'warn') ? 'warn' : null) : n.err ? 'error' : n.warn ? 'warn' : null
    ctx.fillStyle = n.type === 'group' ? C.bg : C.card
    ctx.strokeStyle = n.id === o.selected ? C.accent : n.type === 'bus' ? C.ev : worst === 'error' ? C.err : worst === 'warn' ? C.warn : C.line
    ctx.lineWidth = n.id === o.selected ? 2.5 : 1
    ctx.beginPath()
    if (ctx.roundRect) ctx.roundRect(p.x, p.y, p.w, p.h, n.type === 'bus' ? p.h / 2 : 11); else ctx.rect(p.x, p.y, p.w, p.h)
    ctx.fill(); ctx.stroke()
    if (far && n.type !== 'group') continue
    if (view.k < 0.3 && n.type !== 'group') continue
    if (n.type === 'bus') { ctx.fillStyle = C.ev; ctx.font = '600 11px ui-monospace, Menlo, monospace'; ctx.fillText(label(n.event, 22), p.x + 10, p.y + 18); continue }
    if (n.type === 'group') {
      ctx.fillStyle = C.ink
      ctx.font = `650 ${far ? Math.round(14 / Math.max(view.k, 0.15)) : 14}px system-ui, sans-serif`
      ctx.fillText(label(n.key.split('/').pop() || n.key, 24), p.x + 16, p.y + 26)
      if (!far) { ctx.fillStyle = C.muted; ctx.font = '11px system-ui, sans-serif'; ctx.fillText(`${n.count} components`, p.x + 16, p.y + 72) }
      continue
    }
    ctx.fillStyle = C.ink; ctx.font = '650 14px system-ui, sans-serif'; ctx.fillText(label(c.name, 22), p.x + 16, p.y + 24)
    ctx.fillStyle = C.muted; ctx.font = '11px ui-monospace, Menlo, monospace'; ctx.fillText(label(c.ghost ? 'not scanned' : (c.file || '').split('/').pop(), 30), p.x + 16, p.y + 41)
  }
  ctx.globalAlpha = 1
  ctx.restore()
}

export function hitNode(scene, view, x, y) {
  const wx = (x - view.x) / view.k, wy = (y - view.y) / view.k
  const { P, L } = scene
  for (let i = P.nodes.length - 1; i >= 0; i--) {
    const n = P.nodes[i], p = L.pos.get(n.id)
    if (p && wx >= p.x && wx <= p.x + p.w && wy >= p.y && wy <= p.y + p.h) return n
  }
  return null
}
