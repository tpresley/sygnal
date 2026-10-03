// Row data shared by every scenario app, so each framework renders exactly the
// same strings. Deterministic (no Math.random), unlike js-framework-benchmark.
const adjectives = ['pretty', 'large', 'big', 'small', 'tall', 'short', 'long', 'handsome', 'plain', 'quaint', 'clean', 'elegant', 'easy', 'angry', 'crazy', 'helpful', 'mushy', 'odd', 'unsightly', 'adorable', 'important', 'inexpensive', 'cheap', 'expensive', 'fancy']
const colours = ['red', 'yellow', 'blue', 'green', 'pink', 'brown', 'purple', 'brown', 'white', 'black', 'orange']
const nouns = ['table', 'chair', 'house', 'bbq', 'desk', 'car', 'pony', 'cookie', 'sandwich', 'burger', 'pizza', 'mouse', 'keyboard']

export function buildRows(count, firstId) {
  const rows = new Array(count)
  for (let i = 0; i < count; i++) {
    const id = firstId + i
    rows[i] = { id, label: `${adjectives[id % 25]} ${colours[(id * 7) % 11]} ${nouns[(id * 3) % 13]}` }
  }
  return rows
}

// Swap the 2nd and the 999th row (js-framework-benchmark's swap), on a copy.
export function swapped(rows) {
  if (rows.length <= 998) return rows
  const next = rows.slice()
  const second = next[1]
  next[1] = next[998]
  next[998] = second
  return next
}
