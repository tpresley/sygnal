// What the terminal shows of each element (its "CSS"): a full-screen column (title bar, the
// current tab's panel, the status bar pinned at the bottom), the issue list and its detail side
// by side, the list scrolling in its own box.
export const terminalStyles = [
  ['main.tracker', { display: 'flex', flexDirection: 'column', height: '100%' }],
  ['.title-bar', { display: 'flex', flexDirection: 'row' }],
  ['h1', { color: 'green', upper: true }],
  ['.tab[aria-selected="true"]', { bold: true, underline: true }],
  ['.panel', { flex: 1, display: 'flex', flexDirection: 'column' }],
  ['.split', { flex: 1, display: 'flex', flexDirection: 'row' }],
  ['.issues', { width: '45%', border: 'round', overflow: 'auto' }],
  ['.issues:focus-within', { borderColor: 'cyan' }],
  ['.detail', { flex: 1, border: 'round', padding: [0, 1], overflow: 'auto' }],
  ['.issue.selected', { bold: true }],
  ['.issue.closed', { dim: true }],
  ['.id', { color: 'gray' }],
  ['.prio-high', { color: 'red' }],
  ['.prio-medium', { color: 'yellow' }],
  ['.prio-low', { color: 'gray' }],
  ['.error', { color: 'red' }],
  ['.meta', { color: 'gray' }],
  ['.new-issue', { overflow: 'auto', flex: 1 }],
  ['.status-bar', { inverse: true }],
  ['.status-bar span', { after: '  ' }],
]
