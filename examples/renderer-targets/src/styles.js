// What a terminal shows of each element (its "CSS"): the cart's items dimmed and ticked, the
// aisle in gray after the name, a separator where the web layout has a flex gap
export const terminalStyles = [
  ['h1', { color: 'green', upper: true }],
  ['.item.done label', { dim: true, after: ' ✓' }],
  ['.category', { color: 'gray', before: ' (', after: ')' }],
  ['footer', { before: '— ' }],
  ['.count', { after: ' · ' }],
]
