// PLAN-5 4-B: the offline guides in dist/guide (scripts/copy-guides.mjs). Every shipped entry
// exists in the docs, is built and current, and every link between shipped pages (and every
// in-page anchor) resolves offline: the file is there and the anchor is a heading in it.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { allGuides, parts, outPath, convert, copyGuides } from '../scripts/copy-guides.mjs'

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const docs = path.join(repo, 'docs', 'src', 'content', 'docs')
const dist = path.join(repo, 'dist', 'guide')

// github-slugger's rule (what Starlight uses for heading ids), on the heading's text
function slugs(md) {
  const seen = new Map()
  const out = new Set()
  const noCode = md.replace(/^(```|~~~)[\s\S]*?^\1/gm, '')
  for (const [, raw] of noCode.matchAll(/^#{1,6}\s+(.+?)\s*#*\s*$/gm)) {
    const text = raw.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/<[^>]+>/g, '').replace(/[`*_]/g, (c) => (c === '_' ? c : ''))
    let slug = text.toLowerCase().replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, '').replace(/ /g, '-')
    const n = seen.get(slug) ?? 0
    seen.set(slug, n + 1)
    if (n) slug = `${slug}-${n}`
    out.add(slug)
  }
  return out
}

const entries = allGuides().map((e) => { const [section, name] = parts(e); return { e, section, name, out: outPath(section, name) } })

describe('offline guides (dist/guide)', () => {
  it('every entry has a docs page, and the output paths are unique', () => {
    for (const { section, name } of entries) expect(fs.existsSync(path.join(docs, section, `${name}.md`)), `${section}/${name}`).toBe(true)
    const outs = entries.map((x) => x.out)
    expect(new Set(outs).size).toBe(outs.length)
  })

  it('every entry is built and current (copyGuides --check)', () => {
    expect(copyGuides({ check: true })).toBe(0)
    for (const { out } of entries) {
      const text = fs.readFileSync(path.join(dist, out), 'utf8')
      expect(text.split('\n', 3)[1], out).not.toBe('---')   // the frontmatter became a heading
      expect(text, out).toMatch(/^<!-- Generated from docs\/src\/content\/docs\/[\w-]+ .*\n# \S/)
    }
  })

  it('ships the PLAN-5 pages; the ui/ section keeps its directory', () => {
    const outs = entries.map((x) => x.out)
    for (const p of ['widgets', 'web-components', 'forms', 'browser-sources', 'virtual-collections', 'adapters', 'drag-and-drop', 'ssr', 'error-boundaries']) {
      expect(outs).toContain(`${p}.md`)
    }
    const ui = fs.readdirSync(path.join(docs, 'ui')).filter((f) => f.endsWith('.md')).map((f) => `ui/${f}`)
    for (const p of ui) expect(outs).toContain(p)
  })

  it('every relative link and in-page anchor resolves offline; no site-relative link is left', () => {
    const bad = []
    for (const { out } of entries) {
      const file = path.join(dist, out)
      const text = fs.readFileSync(file, 'utf8')
      const prose = text.replace(/^(```|~~~)[\s\S]*?^\1/gm, '')
      for (const [, href] of prose.matchAll(/\]\(([^)\s]+)\)/g)) {
        if (/^https?:|^mailto:/.test(href)) continue
        if (href.startsWith('/')) { bad.push(`${out}: site-relative ${href}`); continue }
        const [target, hash] = href.split('#')
        if (!target && !hash) continue
        if (target && !/^\.\.?\//.test(target)) continue           // not a page link (e.g. a code sample in prose)
        const dest = target ? path.resolve(path.dirname(file), target) : file
        if (!fs.existsSync(dest)) { bad.push(`${out}: ${href} (no file)`); continue }
        if (hash && !slugs(fs.readFileSync(dest, 'utf8')).has(hash)) bad.push(`${out}: ${href} (no heading)`)
      }
    }
    expect(bad).toEqual([])
  })

  it('links from a subdirectory page climb out; links into it descend', () => {
    const into = convert('---\ntitle: X\n---\n[d](/ui/dialog/#api) [m](/guide/forms/)', 'guide', 'widgets')
    expect(into).toContain('[d](./ui/dialog.md#api) [m](./forms.md)')
    const out = convert('---\ntitle: X\n---\n[w](/guide/widgets/) [p](/ui/popover/) [r](/guide/router/)', 'ui', 'dialog')
    expect(out).toContain('[w](../widgets.md) [p](./popover.md) [r](https://sygnal.js.org/guide/router/)')
  })
})
