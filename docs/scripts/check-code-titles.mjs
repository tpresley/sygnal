#!/usr/bin/env node
/**
 * File-name tab check for the built docs site (run after `astro build`).
 *
 * Expressive Code turns a block's first line into the frame's title tab only when it is a
 * comment holding just a file name it accepts (`// TaskPage.jsx`): letters, digits and
 * `. / ~ % [ ] + \ -`, with an extension of the block's language group (a lowercase path with a
 * `/` skips that). Anything else stays in the code as a plain comment, so the block silently
 * shows no tab: `// TaskPage.jsx: the page reads it` (text after the name), or a Vike route
 * `// pages/quote/@id/+data.js` (`@` isn't accepted). For those, write the name alone, or give
 * the fence `title="pages/quote/@id/+data.js"`.
 *
 * Fails when a frame without a title still starts with a comment that is only a file name.
 *
 *   node scripts/check-code-titles.mjs [distDir]
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const docsRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dist = path.resolve(process.argv[2] || path.join(docsRoot, 'dist'))

const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
  const p = path.join(dir, e.name)
  return e.isDirectory() ? walk(p) : [p]
})
const text = (s) => s.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&amp;/g, '&')
const FILE_COMMENT = /^\s*(?:\/\/|#(?!!)|<!--|\/\*)\s*(\S+\.(?:jsx?|tsx?|mjs|cjs|json|html?|css|astro|vue|mdx?|ya?ml|toml|sh))\s*(?:-->|\*\/)?\s*$/i

const problems = []
for (const file of walk(dist).filter(f => f.endsWith('.html'))) {
  const html = fs.readFileSync(file, 'utf8')
  for (const [, cls, body] of html.matchAll(/<figure class="([^"]*)"[^>]*>([\s\S]*?)<\/figure>/g)) {
    if (!/\bframe\b/.test(cls) || /\bhas-title\b/.test(cls)) continue
    const first = body.match(/<div class="ec-line[^"]*">([\s\S]*?)<\/div><\/div>/)
    const m = first && text(first[1]).match(FILE_COMMENT)
    if (m) problems.push(`${path.relative(dist, file)}: a code block starts with "${text(first[1]).trim()}" but shows no file-name tab (Expressive Code didn't accept it: write the name alone, or use title="${m[1]}" on the fence)`)
  }
}
if (problems.length) {
  console.error(problems.join('\n'))
  console.error(`check-code-titles: ${problems.length} code block(s) without their file-name tab`)
  process.exit(1)
}
console.log('check-code-titles: every file-name comment became a tab')
