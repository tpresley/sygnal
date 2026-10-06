// Skill / docs / library-source reading per trial.
//
// Skill files are read three ways in practice:
//   1. the Skill tool, which injects SKILL.md in full;
//   2. Read with optional offset/limit;
//   3. Bash: cat, sed -n 'a,bp', sed -n '/re1/,/re2/p', head, grep -n -A/-B.
// For each, we work out which line ranges of which skill file were seen, so
// a heatmap of markdown sections x trials can be built. grep output with -n
// gives exact line numbers; other forms we can't resolve count as 'unknown'.
import fs from 'node:fs'
import path from 'node:path'

export const SKILL_DIR_DEFAULT = path.join(process.env.HOME ?? '', '.claude', 'skills', 'sygnal-dev')

/** Markdown sections of a file: [{ heading, level, start, end }] (1-based, inclusive). */
export function sections(text) {
  const lines = String(text).split('\n')
  const heads = []
  let inFence = false
  lines.forEach((l, i) => {
    if (/^```/.test(l)) inFence = !inFence
    const m = !inFence && l.match(/^(#{1,3})\s+(.*)/)
    if (m) heads.push({ heading: m[2].trim(), level: m[1].length, start: i + 1 })
  })
  return heads.map((h, k) => {
    // a section runs to the next heading of the same or higher level
    const next = heads.slice(k + 1).find((x) => x.level <= h.level)
    const nextAny = heads[k + 1]
    return { ...h, end: (next ? next.start : lines.length + 1) - 1, ownEnd: (nextAny ? nextAny.start : lines.length + 1) - 1 }
  })
}

export function loadSkill(skillDir = SKILL_DIR_DEFAULT) {
  const files = {}
  const walk = (d) => {
    for (const ent of fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }) : []) {
      const p = path.join(d, ent.name)
      if (ent.isDirectory()) walk(p)
      else if (ent.name.endsWith('.md')) {
        const text = fs.readFileSync(p, 'utf8')
        files[path.relative(skillDir, p)] = { text, lines: text.split('\n').length, bytes: Buffer.byteLength(text), sections: sections(text) }
      }
    }
  }
  walk(skillDir)
  return { dir: skillDir, files }
}

const relSkill = (p, skill) => {
  const s = String(p)
  for (const rel of Object.keys(skill.files)) if (s.endsWith(rel) || (s.endsWith('/' + path.basename(rel)) && s.includes('skills'))) return rel
  return null
}

/** Line numbers printed by `grep -n` (with -A/-B context lines "N-") for a single file. */
export function grepLineNumbers(resultText) {
  const out = []
  for (const l of String(resultText).split('\n')) {
    const m = l.match(/^(?:[^\s:]+\.md[:-])?(\d+)[:-]/)
    if (m) out.push(Number(m[1]))
  }
  return out
}

/** Turn a sorted list of line numbers into [start, end] ranges. */
export function toRanges(nums) {
  const s = [...new Set(nums)].sort((a, b) => a - b)
  const out = []
  for (const n of s) {
    const last = out[out.length - 1]
    if (last && n <= last[1] + 1) last[1] = n
    else out.push([n, n])
  }
  return out
}

function headingLine(file, re) {
  const lines = file.text.split('\n')
  for (let i = 0; i < lines.length; i++) if (re.test(lines[i])) return i + 1
  return null
}

/**
 * Ranges of skill files covered by one call: [{ file, ranges: [[a,b]], bytes, how }].
 */
export function skillReadsOfCall(call, skill) {
  const out = []
  const i = call.input ?? {}
  const res = call.result?.text ?? ''
  if (call.name === 'Skill') {
    const rel = Object.keys(skill.files).find((f) => /^SKILL\.md$/.test(f))
    if (rel) out.push({ file: rel, ranges: [[1, skill.files[rel].lines]], bytes: skill.files[rel].bytes, how: 'skill-tool' })
    return out
  }
  if (call.name === 'Read') {
    const rel = relSkill(i.file_path, skill)
    if (!rel) return out
    const f = skill.files[rel]
    const a = Math.max(1, Number(i.offset ?? 1))
    const b = Math.min(f.lines, a + Number(i.limit ?? 2000) - 1)
    out.push({ file: rel, ranges: [[a, b]], bytes: Buffer.byteLength(res), how: 'read' })
    return out
  }
  if (call.name === 'Grep') {
    const rel = relSkill(i.path, skill)
    if (rel) out.push({ file: rel, ranges: toRanges(grepLineNumbers(res)), bytes: Buffer.byteLength(res), how: 'grep' })
    return out
  }
  if (call.name !== 'Bash') return out
  const cmd = String(i.command ?? '')
  if (!/skills\//.test(cmd) && !/component-patterns\.md|SKILL\.md|references\/[\w.-]+\.md/.test(cmd)) return out
  // One command can touch several skill files; split by segment.
  const segs = cmd.split(/&&|;|\n/)
  let anyGrep = false
  const ranges = {}
  const push = (rel, r) => (ranges[rel] ??= []).push(r)
  for (const seg of segs) {
    // any skill file named in the segment (multi-file skills, e.g. PLAN-5 4-S references/*.md)
    const named = [...seg.matchAll(/[^\s'"|<>]*\.md\b/g)].map((m) => relSkill(m[0], skill)).find(Boolean)
    const rel = named ?? (/component-patterns\.md/.test(seg) ? 'references/component-patterns.md' : /SKILL\.md/.test(seg) ? 'SKILL.md' : null)
    if (!rel || !skill.files[rel]) continue
    const f = skill.files[rel]
    let m
    if ((m = seg.match(/sed\s+-n\s+['"]?(\d+),(\d+)p/))) push(rel, [Number(m[1]), Number(m[2])])
    else if ((m = seg.match(/sed\s+-n\s+['"]\/(.+?)\/,\/(.+?)\/p/))) {
      const a = headingLine(f, new RegExp(m[1].replace(/\\\./g, '\\.')))
      const b = headingLine(f, new RegExp(m[2].replace(/\\\./g, '\\.')))
      if (a) push(rel, [a, b ?? f.lines])
    } else if (/\bgrep\b/.test(seg)) anyGrep = true
    else if ((m = seg.match(/\bhead\s+-(?:n\s*)?(\d+)/)) && !/\|/.test(seg)) push(rel, [1, Number(m[1])])
    else if (/\bcat\b/.test(seg) && !/\|\s*grep/.test(seg)) push(rel, [1, f.lines])
    else if (/\bcat\b/.test(seg)) anyGrep = true
  }
  if (anyGrep) {
    // grep -n output: line numbers apply to whichever skill file the grep named.
    const rel = [...cmd.matchAll(/[^\s'"|<>]*\.md\b/g)].map((m) => relSkill(m[0], skill)).find(Boolean) ?? (/component-patterns\.md/.test(cmd) ? 'references/component-patterns.md' : 'SKILL.md')
    const nums = grepLineNumbers(res).filter((n) => n <= (skill.files[rel]?.lines ?? 0))
    if (nums.length) for (const r of toRanges(nums)) push(rel, r)
    else if (!ranges[rel]) ranges[rel] = []
  }
  for (const [rel, rs] of Object.entries(ranges)) out.push({ file: rel, ranges: rs, bytes: Buffer.byteLength(res), how: 'bash' })
  return out
}

/** Sections (by heading) overlapped by a set of ranges in one file. */
export function sectionsHit(file, ranges) {
  const hit = new Set()
  for (const s of file.sections) {
    const end = s.ownEnd
    if (ranges.some(([a, b]) => a <= end && b >= s.start)) hit.add(s.heading)
  }
  return [...hit]
}

/** Library source / docs files read (node_modules/<pkg>/...): [{ pkg, file, how }]. */
export function libraryReadsOfCall(call) {
  const i = call.input ?? {}
  const txt = [i.file_path, i.path, i.command, i.pattern].filter(Boolean).join(' ')
  const out = []
  for (const m of txt.matchAll(/node_modules\/((?:@[\w.-]+\/)?[\w.-]+)((?:\/[\w.@-]+)*)/g)) {
    const pkg = m[1]
    if (pkg === '.bin') continue
    out.push({ pkg, file: (m[2] || '/').slice(1) || '(dir)' })
  }
  // `cd node_modules/sygnal/src && grep ... file` style: catch relative mentions too.
  if (/cd [^\s;&]*node_modules\/sygnal/.test(txt) && !out.length) out.push({ pkg: 'sygnal', file: '(dir)' })
  return out
}

/** Per-trial skill/docs summary. */
export function skillUsage(parsed, skill) {
  const reads = []
  const lib = {}
  let libBytes = 0
  for (const c of parsed.calls) {
    for (const r of skillReadsOfCall(c, skill)) reads.push(r)
    const lr = libraryReadsOfCall(c)
    if (lr.length && c.result && !/is isolated in the worktree/.test(c.result.text)) {
      // `ls node_modules/x` or a find that prunes node_modules is not reading library docs/source.
      const cmd = String(c.input?.command ?? '')
      if (c.name === 'Bash' && /-prune|^\s*ls\b/.test(cmd) && !/\b(cat|sed|grep|head|tail|less)\b/.test(cmd)) continue
      libBytes += Buffer.byteLength(c.result.text)
      for (const { pkg, file } of lr) {
        lib[pkg] ??= new Set()
        lib[pkg].add(file)
      }
    }
  }
  const byFile = {}
  for (const r of reads) {
    const e = (byFile[r.file] ??= { ranges: [], bytes: 0, how: new Set() })
    e.ranges.push(...r.ranges)
    e.bytes += r.bytes
    e.how.add(r.how)
  }
  const files = {}
  const sectionSet = []
  for (const [rel, e] of Object.entries(byFile)) {
    const f = skill.files[rel]
    const merged = toRanges(e.ranges.flatMap(([a, b]) => Array.from({ length: Math.max(0, b - a + 1) }, (_, k) => a + k)))
    const linesSeen = merged.reduce((s, [a, b]) => s + b - a + 1, 0)
    const secs = f ? sectionsHit(f, merged) : []
    files[rel] = { ranges: merged, linesSeen, fileLines: f?.lines ?? null, bytes: e.bytes, how: [...e.how] }
    for (const s of secs) sectionSet.push(`${rel}#${s}`)
  }
  return {
    skillInvoked: parsed.skillInvoked,
    skillBytes: Object.values(files).reduce((s, f) => s + f.bytes, 0),
    files,
    sections: sectionSet,
    library: Object.fromEntries(Object.entries(lib).map(([k, v]) => [k, [...v].sort()])),
    libraryBytes: libBytes,
  }
}
