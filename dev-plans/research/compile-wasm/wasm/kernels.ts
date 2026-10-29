// AssemblyScript kernels for the JS <-> WASM experiments (bench.mjs in this folder). Each has a
// line-for-line JS twin in kernels-js.mjs, so the comparison is the engine, not the algorithm.

// 1. the boundary: an export that does nothing
export function noop(x: i32): i32 { return x + 1 }

// 2. the same-output check on a flat encoding of two vnode trees: per node 5 i32
//    [sel id, key hash, text hash, data hash, child count], preorder. Returns 1 when equal.
export function sameFlat(a: usize, b: usize, n: i32): i32 {
  for (let i = 0; i < n * 5; i++) if (load<i32>(a + (<usize>i << 2)) != load<i32>(b + (<usize>i << 2))) return 0
  return 1
}

// 3. keyed reconciliation: for old keys (n) and new keys (m), both distinct i32, write for each new
//    index the old index (or -1) to `src`, and mark in `keep` the new indices on the longest
//    increasing subsequence of old indices (those nodes don't move). Returns the number of moves.
//    The key -> old index map is an open-addressing hash table in `tbl` (cap: a power of two).
export function keyedMoves(oldK: usize, n: i32, newK: usize, m: i32, src: usize, keep: usize, tbl: usize, cap: i32, tails: usize, prev: usize): i32 {
  const mask = cap - 1
  for (let i = 0; i < cap; i++) store<i32>(tbl + (<usize>i << 3), -1)
  for (let i = 0; i < n; i++) {
    const k = load<i32>(oldK + (<usize>i << 2))
    let h = (k * 0x9E3779B1) & mask
    while (load<i32>(tbl + (<usize>h << 3)) != -1) h = (h + 1) & mask
    store<i32>(tbl + (<usize>h << 3), k); store<i32>(tbl + (<usize>h << 3) + 4, i)
  }
  for (let j = 0; j < m; j++) {
    const k = load<i32>(newK + (<usize>j << 2))
    let h = (k * 0x9E3779B1) & mask, s = -1
    while (true) {
      const t = load<i32>(tbl + (<usize>h << 3))
      if (t == -1) break
      if (t == k) { s = load<i32>(tbl + (<usize>h << 3) + 4); break }
      h = (h + 1) & mask
    }
    store<i32>(src + (<usize>j << 2), s)
    store<u8>(keep + <usize>j, 0)
  }
  // LIS over src (patience, with predecessor links)
  let len = 0
  for (let j = 0; j < m; j++) {
    const v = load<i32>(src + (<usize>j << 2))
    if (v < 0) continue
    let lo = 0, hi = len
    while (lo < hi) { const mid = (lo + hi) >>> 1; if (load<i32>(src + (<usize>load<i32>(tails + (<usize>mid << 2)) << 2)) < v) lo = mid + 1; else hi = mid }
    store<i32>(prev + (<usize>j << 2), lo > 0 ? load<i32>(tails + (<usize>(lo - 1) << 2)) : -1)
    store<i32>(tails + (<usize>lo << 2), j)
    if (lo == len) len++
  }
  let j = len > 0 ? load<i32>(tails + (<usize>(len - 1) << 2)) : -1
  while (j >= 0) { store<u8>(keep + <usize>j, 1); j = load<i32>(prev + (<usize>j << 2)) }
  let moves = 0
  for (let j = 0; j < m; j++) if (load<i32>(src + (<usize>j << 2)) >= 0 && load<u8>(keep + <usize>j) == 0) moves++
  return moves
}

// 4. a numeric reducer kernel: an in-place sort of n f64 (insertion sort below 16, else quicksort)
export function sortF64(p: usize, n: i32): void { qs(p, 0, n - 1) }
function qs(p: usize, lo: i32, hi: i32): void {
  while (hi - lo > 16) {
    const mid = lo + ((hi - lo) >> 1)
    const pv = load<f64>(p + (<usize>mid << 3))
    let i = lo, j = hi
    while (i <= j) {
      while (load<f64>(p + (<usize>i << 3)) < pv) i++
      while (load<f64>(p + (<usize>j << 3)) > pv) j--
      if (i <= j) { const t = load<f64>(p + (<usize>i << 3)); store<f64>(p + (<usize>i << 3), load<f64>(p + (<usize>j << 3))); store<f64>(p + (<usize>j << 3), t); i++; j-- }
    }
    if (j - lo < hi - i) { qs(p, lo, j); lo = i } else { qs(p, i, hi); hi = j }
  }
  for (let i = lo + 1; i <= hi; i++) {
    const v = load<f64>(p + (<usize>i << 3)); let j = i - 1
    while (j >= lo && load<f64>(p + (<usize>j << 3)) > v) { store<f64>(p + (<usize>(j + 1) << 3), load<f64>(p + (<usize>j << 3))); j-- }
    store<f64>(p + (<usize>(j + 1) << 3), v)
  }
}

// 5. a streaming-parser kernel: count the SSE event boundaries ("\n\n") in n bytes
export function sseBoundaries(p: usize, n: i32): i32 {
  let c = 0
  for (let i = 1; i < n; i++) if (load<u8>(p + <usize>i) == 10 && load<u8>(p + <usize>(i - 1)) == 10) c++
  return c
}
