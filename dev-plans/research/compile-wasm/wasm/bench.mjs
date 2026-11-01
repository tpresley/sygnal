// JS vs WASM (AssemblyScript, kernels.ts -> kernels.wasm) on the candidates where Sygnal could
// use WASM, with the cost of getting the data across the boundary measured separately.
//   node dev-plans/research/compile-wasm/wasm/bench.mjs
// Build the module (AssemblyScript 0.27, from npm): asc kernels.ts -O3 --runtime stub --initialMemory 512 -o kernels.wasm
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const { instance } = await WebAssembly.instantiate(readFileSync(resolve(import.meta.dirname, 'kernels.wasm')), { env: { abort() { throw new Error('abort') } } })
const W = instance.exports, mem = W.memory.buffer
const BASE = 1 << 16 // scratch region in linear memory (the stub runtime allocates nothing)

// time fn() over enough repetitions for >= 200 ms, best of 5 batches: ns per call
function time(fn, minMs = 40) {
  let n = 1, best = Infinity
  for (;;) { const t = performance.now(); for (let i = 0; i < n; i++) fn(); const d = performance.now() - t; if (d > minMs) break; n *= 2 }
  for (let r = 0; r < 5; r++) { const t = performance.now(); for (let i = 0; i < n; i++) fn(); best = Math.min(best, (performance.now() - t) / n) }
  return best * 1e6
}
const fmt = (ns) => ns >= 1e6 ? (ns / 1e6).toFixed(2) + ' ms' : ns >= 1e3 ? (ns / 1e3).toFixed(1) + ' µs' : ns.toFixed(1) + ' ns'
const row = (label, ...cells) => console.log(label.padEnd(52) + cells.map(c => String(c).padStart(14)).join(''))
let sink = 0

// ---------------------------------------------------------------- 1. the boundary
{
  const js = (x) => x + 1
  console.log('\n1. call cost (one i32 in, one out), per call')
  row('', 'JS', 'WASM')
  row('noop(x)', fmt(time(() => { for (let i = 0; i < 1000; i++) sink += js(i) }) / 1000), fmt(time(() => { for (let i = 0; i < 1000; i++) sink += W.noop(i) }) / 1000))
}

// ---------------------------------------------------------------- 2. same-output check on a vnode tree
// the benchmark table's rows as the pragma makes them (1,000 rows, 4 vnodes each)
function Plain(sel, data, children, text, key) { this.sel = sel; this.data = data; this.children = children; this.text = text; this.elm = undefined; this.key = key }
const cls = (c) => ({ props: { className: c } })
const rows = Array.from({ length: 1000 }, (_, i) => ({ id: i + 1, label: 'pretty red table ' + i }))
const tree = () => new Plain('div', cls('table'), rows.map(r => new Plain('div', { props: { className: 'row' }, dataset: { id: r.id } }, [
  new Plain('span', cls('col-id'), undefined, '' + r.id), new Plain('a', cls('lbl'), undefined, r.label), new Plain('a', cls('remove'), undefined, 'x')], undefined, r.id)))
// the core's check (src/core/instance.ts same + src/cycle/dom/utils.ts sameData), without SAME_MAX
const obj = (o) => o !== null && typeof o == 'object' && !Array.isArray(o)
function sameData(a, b) {
  if (a === b) return true; if (!a || !b) return false
  let n = 0
  for (const k in a) { n++; const x = a[k], y = b[k]; if (x !== y) { if (!obj(x) || !obj(y)) return false; let m = 0; for (const j in x) { m++; if (x[j] !== y[j]) return false } for (const _ in y) m--; if (m) return false } }
  for (const _ in b) n--
  return !n
}
function same(a, b) {
  if (a === b) return true
  if (!a || !b || a.sel !== b.sel || a.key !== b.key || a.text !== b.text || !sameData(a.data, b.data)) return false
  const x = a.children, y = b.children
  if (x === y) return true; if (!x || !y || x.length !== y.length) return false
  for (let i = 0; i < x.length; i++) if (!same(x[i], y[i])) return false
  return true
}
// the encoding the WASM check needs: 5 i32 per node; strings and data hashed (FNV-1a) in JS
const sels = new Map()
const hs = (s) => { if (s === undefined) return 0; s = '' + s; let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h }
const hd = (d) => { let h = 0; for (const k in d) { const v = d[k]; h = Math.imul(h ^ hs(k), 31); if (obj(v)) for (const j in v) h = Math.imul(h ^ hs(j) ^ hs(v[j]), 31); else h ^= hs(v) } return h }
function encode(v, out, i) {
  let s = sels.get(v.sel); if (s === undefined) sels.set(v.sel, s = sels.size + 1)
  out[i] = s; out[i + 1] = hs(v.key); out[i + 2] = hs(v.text); out[i + 3] = hd(v.data); out[i + 4] = v.children ? v.children.length : 0
  i += 5
  if (v.children) for (const c of v.children) i = encode(c, out, i)
  return i
}
{
  const a = tree(), b = tree(), N = 4001
  const ea = new Int32Array(mem, BASE, N * 5), eb = new Int32Array(mem, BASE + N * 20, N * 5)
  console.log('\n2. same-output check, two equal 1,000-row trees (4,001 vnodes)')
  row('', 'JS', 'WASM')
  const tjs = time(() => { sink += same(a, b) })
  const tenc = time(() => { encode(a, ea, 0); encode(b, eb, 0) })
  const tw = time(() => { sink += W.sameFlat(BASE, BASE + N * 20, N) })
  row('compare (the check itself)', fmt(tjs), fmt(tw))
  row('  + encode both trees into linear memory (JS)', '', fmt(tenc))
  row('  total', fmt(tjs), fmt(tenc + tw))
}

// ---------------------------------------------------------------- 3. keyed reconciliation moves
function keyedMovesJS(oldK, n, newK, m, src, keep, tails, prev) {
  const map = new Map()
  for (let i = 0; i < n; i++) map.set(oldK[i], i)
  for (let j = 0; j < m; j++) { const s = map.get(newK[j]); src[j] = s === undefined ? -1 : s; keep[j] = 0 }
  let len = 0
  for (let j = 0; j < m; j++) {
    const v = src[j]; if (v < 0) continue
    let lo = 0, hi = len
    while (lo < hi) { const mid = (lo + hi) >>> 1; if (src[tails[mid]] < v) lo = mid + 1; else hi = mid }
    prev[j] = lo > 0 ? tails[lo - 1] : -1; tails[lo] = j; if (lo === len) len++
  }
  let j = len > 0 ? tails[len - 1] : -1
  while (j >= 0) { keep[j] = 1; j = prev[j] }
  let moves = 0
  for (let j = 0; j < m; j++) if (src[j] >= 0 && !keep[j]) moves++
  return moves
}
// the JS twin with kernels.ts's own open-addressing table (Int32Array) instead of a Map
function keyedMovesJS2(oldK, n, newK, m, src, keep, tbl, cap, tails, prev) {
  const mask = cap - 1
  tbl.fill(-1)
  for (let i = 0; i < n; i++) { const k = oldK[i]; let h = Math.imul(k, 0x9E3779B1) & mask; while (tbl[h << 1] !== -1) h = (h + 1) & mask; tbl[h << 1] = k; tbl[(h << 1) + 1] = i }
  for (let j = 0; j < m; j++) {
    const k = newK[j]; let h = Math.imul(k, 0x9E3779B1) & mask, s = -1
    for (;;) { const t = tbl[h << 1]; if (t === -1) break; if (t === k) { s = tbl[(h << 1) + 1]; break } h = (h + 1) & mask }
    src[j] = s; keep[j] = 0
  }
  let len = 0
  for (let j = 0; j < m; j++) {
    const v = src[j]; if (v < 0) continue
    let lo = 0, hi = len
    while (lo < hi) { const mid = (lo + hi) >>> 1; if (src[tails[mid]] < v) lo = mid + 1; else hi = mid }
    prev[j] = lo > 0 ? tails[lo - 1] : -1; tails[lo] = j; if (lo === len) len++
  }
  let j = len > 0 ? tails[len - 1] : -1
  while (j >= 0) { keep[j] = 1; j = prev[j] }
  let moves = 0
  for (let j = 0; j < m; j++) if (src[j] >= 0 && !keep[j]) moves++
  return moves
}
console.log('\n3. keyed reconciliation (key map + LIS: which children move), per diff')
row('', 'JS (Map)', 'JS (table)', 'WASM', 'WASM+copy')
for (const [label, n, mk] of [
  ['1k, swap 2 and 999', 1000, (k) => { const r = k.slice(); [r[1], r[998]] = [r[998], r[1]]; return r }],
  ['10k, swap 2 and 9,999', 10000, (k) => { const r = k.slice(); [r[1], r[9998]] = [r[9998], r[1]]; return r }],
  ['10k, reversed', 10000, (k) => k.slice().reverse()],
  ['10k, shuffled', 10000, (k) => { const r = k.slice(); let s = 1; for (let i = r.length - 1; i > 0; i--) { s = (s * 16807) % 2147483647; const j = s % (i + 1); [r[i], r[j]] = [r[j], r[i]] } return r }],
]) {
  const oldArr = Array.from({ length: n }, (_, i) => i + 1), newArr = mk(oldArr)
  // the vnodes the keys come from (the copy column: keys read from vnodes into linear memory)
  const oldV = oldArr.map(k => ({ key: k })), newV = newArr.map(k => ({ key: k }))
  const oK = Int32Array.from(oldArr), nK = Int32Array.from(newArr)
  const src = new Int32Array(n), keep = new Uint8Array(n), tails = new Int32Array(n), prev = new Int32Array(n)
  const cap = 1 << Math.ceil(Math.log2(n * 2))
  const P = { oK: BASE, nK: BASE + n * 4, src: BASE + n * 8, keep: BASE + n * 12, tbl: BASE + n * 16, tails: BASE + n * 16 + cap * 8, prev: BASE + n * 20 + cap * 8 }
  const wo = new Int32Array(mem, P.oK, n), wn = new Int32Array(mem, P.nK, n)
  wo.set(oK); wn.set(nK)
  const jtbl = new Int32Array(cap * 2)
  const rj2 = keyedMovesJS2(oK, n, nK, n, src, keep, jtbl, cap, tails, prev)
  const rj = keyedMovesJS(oK, n, nK, n, src, keep, tails, prev), rw = W.keyedMoves(P.oK, n, P.nK, n, P.src, P.keep, P.tbl, cap, P.tails, P.prev)
  if (rj !== rw || rj2 !== rj) throw new Error(`moves differ: ${rj} vs ${rw}`)
  const tjs = time(() => { sink += keyedMovesJS(oK, n, nK, n, src, keep, tails, prev) })
  const tjs2 = time(() => { sink += keyedMovesJS2(oK, n, nK, n, src, keep, jtbl, cap, tails, prev) })
  const tw = time(() => { sink += W.keyedMoves(P.oK, n, P.nK, n, P.src, P.keep, P.tbl, cap, P.tails, P.prev) })
  const tcopy = time(() => { for (let i = 0; i < n; i++) { wo[i] = oldV[i].key; wn[i] = newV[i].key } })
  row(`${label} (${rj} moves)`, fmt(tjs), fmt(tjs2), fmt(tw), fmt(tw + tcopy))
}

// ---------------------------------------------------------------- 4. a numeric reducer
{
  console.log('\n4. a heavy reducer: sort 1M f64 (state as a typed array), per sort')
  row('', 'JS native', 'JS quicksort', 'WASM')
  const n = 1 << 20, data = new Float64Array(n)
  let s = 7; for (let i = 0; i < n; i++) { s = (s * 16807) % 2147483647; data[i] = s / 2147483647 }
  const a = new Float64Array(n), wv = new Float64Array(mem, BASE, n)
  function qs(p, lo, hi) {
    while (hi - lo > 16) {
      const pv = p[lo + ((hi - lo) >> 1)]; let i = lo, j = hi
      while (i <= j) { while (p[i] < pv) i++; while (p[j] > pv) j--; if (i <= j) { const t = p[i]; p[i] = p[j]; p[j] = t; i++; j-- } }
      if (j - lo < hi - i) { qs(p, lo, j); lo = i } else { qs(p, i, hi); hi = j }
    }
    for (let i = lo + 1; i <= hi; i++) { const v = p[i]; let j = i - 1; while (j >= lo && p[j] > v) { p[j + 1] = p[j]; j-- } p[j + 1] = v }
  }
  const copy = time(() => a.set(data), 20)
  const native = time(() => { a.set(data); a.sort() }, 100) - copy
  const jsq = time(() => { a.set(data); qs(a, 0, n - 1) }, 100) - copy
  const wasm = time(() => { wv.set(data); W.sortF64(BASE, n) }, 100) - copy
  row('sort (copy-in excluded)', fmt(native), fmt(jsq), fmt(wasm))
  // the same data as the rows of a JS state tree: the field has to be read out and the order applied back
  const objs = Array.from(data, (v, i) => ({ id: i, v }))
  const out = time(() => { for (let i = 0; i < n; i++) wv[i] = objs[i].v }, 50)
  row('  + reading the field out of 1M row objects', '', '', fmt(out))
}

// ---------------------------------------------------------------- 5. a streaming-parser kernel
{
  console.log('\n5. SSE framing: count event boundaries in a 1 MB chunk, per chunk')
  row('', 'JS (string)', 'JS (bytes)', 'WASM (bytes)')
  const ev = 'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"hello"}\n\n'
  const text = ev.repeat(Math.ceil((1 << 20) / ev.length)), bytes = new TextEncoder().encode(text), n = bytes.length
  const wb = new Uint8Array(mem, BASE, n)
  const strJS = () => { let c = 0, i = -1; while ((i = text.indexOf('\n\n', i + 1)) >= 0) c++; return c }
  const byteJS = () => { let c = 0; for (let i = 1; i < n; i++) if (bytes[i] === 10 && bytes[i - 1] === 10) c++; return c }
  wb.set(bytes)
  if (strJS() !== W.sseBoundaries(BASE, n) || byteJS() !== strJS()) throw new Error('counts differ')
  const tcopy = time(() => wb.set(bytes))
  row('count "\\n\\n"', fmt(time(() => { sink += strJS() })), fmt(time(() => { sink += byteJS() })), fmt(time(() => { sink += W.sseBoundaries(BASE, n) }) + tcopy))
  row('  (the bytes -> string decode JS needs anyway)', fmt(time(() => { sink += new TextDecoder().decode(bytes).length })), '', '')
}
if (sink === 42) console.log('')
