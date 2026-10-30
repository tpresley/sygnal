// Shared by the prototype runners: the file list (sygnal-check's: source extensions, no tests,
// ignored dirs), offsets → 1-based line/column, and the normalized finding lines.
import fs from 'node:fs'
import path from 'node:path'
const EXT = /\.(jsx|tsx|js|ts|mjs|mts|cjs|cts)$/
const IGNORED = new Set(['node_modules', 'dist', 'build', 'coverage', '.git', '.astro', '.vite', '.next', '.svelte-kit', '.turbo', 'out'])
export function listSources(dir) {
  const out = []
  const rec = d => { for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (e.isDirectory()) { if (!IGNORED.has(e.name)) rec(path.join(d, e.name)) } else if (EXT.test(e.name) && !/\.(test|spec)\./.test(e.name) && !e.name.endsWith('.d.ts')) out.push(path.join(d, e.name))
  } }
  rec(dir)
  return out.sort()
}
export function lineCol(text, offset) {
  let line = 1, last = -1
  for (let i = 0; i < offset; i++) if (text.charCodeAt(i) === 10) { line++; last = i }
  return { line, column: offset - last }
}
export const compact = list => [...new Set(list.map(d => `${d.code} ${d.file}:${d.line}:${d.column}`))].sort()
