// js-framework-benchmark style data, deterministic (seeded) so every framework renders the same labels
const A = ['pretty', 'large', 'big', 'small', 'tall', 'short', 'long', 'handsome', 'plain', 'quaint', 'clean', 'elegant', 'easy', 'angry', 'crazy', 'helpful', 'mushy', 'odd', 'unsightly', 'adorable', 'important', 'inexpensive', 'cheap', 'expensive', 'fancy']
const C = ['red', 'yellow', 'blue', 'green', 'pink', 'brown', 'purple', 'brown', 'white', 'black', 'orange']
const N = ['table', 'chair', 'house', 'bbq', 'desk', 'car', 'pony', 'cookie', 'sandwich', 'burger', 'pizza', 'mouse', 'keyboard']
let seed = 1
const rand = (max) => { seed = (seed * 16807) % 2147483647; return seed % max }
let nextId = 1
export function buildData(count) {
  const data = new Array(count)
  for (let i = 0; i < count; i++) data[i] = { id: nextId++, label: `${A[rand(A.length)]} ${C[rand(C.length)]} ${N[rand(N.length)]}` }
  return data
}
export const DEPTH = 30
export const COUNTERS = 1000
export const ITEMS = 1000
export function items(n = ITEMS) { return Array.from({ length: n }, (_, i) => ({ id: i, text: `Item number ${i}` })) }
