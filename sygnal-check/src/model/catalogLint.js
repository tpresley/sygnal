/**
 * PLAN-9 X-2: the catalog description lint (SYG254), on plain data, so it runs the same on a
 * literal `defineCatalog({...})` (rules/syg253-catalog.js) and on the research catalogs it was
 * calibrated on (test/p9-x2-catalog.vtest.js).
 *
 * Input: `{ parts: { id: { description, group?, params?: { name: { label?, options?, bins? } } } } }`
 * (`options` / `bins`: value → description; a part without a string description is skipped).
 *
 * What a decision model reads of a part is its description, and of a param its options; the
 * research (dev-plans/research/ai-compose: structure/REPORT.md, params-edits/REPORT.md §1, §6)
 * traced most selection errors to three catalog wordings, which is what this flags:
 *
 *   'parts'    two parts (not in one `group`) whose descriptions share a phrase: two adjacent
 *              content words, in the same order ("monthly revenue" on the revenue KPI and on the
 *              revenue chart pulled in the wrong part). Words that name the kind of thing (card,
 *              chart, table, list, ...) and filler words don't count, so "KPI card: ..." on three
 *              KPIs is fine.
 *   'mentions' a part's description names one of its own param values ("revenue over the last 12
 *              months" on a part with a `range` param): the option's value as a word ("months" for
 *              `month`), or two or more content words of the option's description. Words of the
 *              part's own name don't count.
 *   'options'  options of two different params of one part that share a content word ("all
 *              tickets, open and closed" on `status`, "tickets of any priority" on `priority`: "show
 *              all tickets, not just the urgent ones" picked the wrong param). all / any / every /
 *              each / whole / full count as one word; the part's own name doesn't count.
 *
 * Calibration (the research catalogs, structure/evals/catalogs.mjs, params-edits/evals/catalogs.mjs,
 * llm/evals/cases.mjs, examples/ai-compose/src/catalog.js): see test/p9-x2-catalog.vtest.js.
 */

const STOP = new Set(`a an the of for to in on at by with and or as is are be been being from into onto than then
this that these those it its it's their there here your our my his her them they we you i me us
not no only just also each per via about over under up down out off so such own one two three four five six seven eight nine ten
last next current this new recent most more less many few some other another
who what which where when how whose
can could will would may might should must do does did has have had get gets shown show shows showing
user users user's s`.split(/\s+/))

// words that say what kind of thing a part is, not what it shows: shared by many parts on purpose
const KIND = new Set(`card cards kpi chart charts graph line bar pie table tables list lists grid form forms field fields
panel widget view section box area button buttons link links banner badge toggle toggles select choice text input
summary page tab tabs row column number numbers value total count item items entry entries feed strip bar bars header footer`.split(/\s+/))

const ALL = new Set(['all', 'any', 'every', 'each', 'whole', 'full', 'everything', 'everyone', 'anyone', 'anything'])

/** a word's comparable form: lowercase, `'s` and plurals dropped, `-ly` adverbs on their root ("monthly" → "month") */
export function stem(w) {
  w = w.toLowerCase().replace(/['’]s$/, '')
  if (ALL.has(w)) return '*all'
  if (w.length > 5 && w.endsWith('ly')) w = w.slice(0, -2)
  if (w.length > 4 && w.endsWith('ies')) w = w.slice(0, -3) + 'y'
  else if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') && !w.endsWith('us')) w = w.slice(0, -1)
  return w
}

/** the words of a text, split on case changes too ("revenueChart" → revenue, chart) */
const words = (text) => String(text ?? '')
  .replace(/([a-z])([A-Z])/g, '$1 $2')
  .split(/[^A-Za-z0-9'’]+/)
  .filter(w => w && !/\d/.test(w))

/** content tokens in order: [{ word, stem }] (filler, kind words and numbers left out) */
export function content(text, { keepKind = false, keepAll = false } = {}) {
  const out = []
  for (const w of words(text)) {
    const lw = w.toLowerCase().replace(/['’]s$/, '')
    if (STOP.has(lw) || STOP.has(w.toLowerCase())) continue
    const s = stem(w)
    if (s === '*all' && !keepAll) continue
    if (!keepKind && (KIND.has(lw) || KIND.has(s))) continue
    if (s.length < 3 && s !== '*all') continue
    out.push({ word: w, stem: s })
  }
  return out
}

/** the phrases (two adjacent content words) of a description, inside one clause */
function phrases(text) {
  const out = new Map()
  for (const clause of String(text ?? '').split(/[,;:()[\]."“”!?—–]+|\s-\s/)) {
    const t = content(clause)
    for (let i = 0; i + 1 < t.length; i++) {
      if (t[i].stem === t[i + 1].stem) continue
      const k = t[i].stem + ' ' + t[i + 1].stem
      if (!out.has(k)) out.set(k, `${t[i].word} ${t[i + 1].word}`)
    }
  }
  return out
}

const nameStems = (id) => new Set(words(id).map(stem))

const optionsOf = (p) => {
  const o = p && typeof p === 'object' ? (p.options && typeof p.options === 'object' ? p.options : p.bins && typeof p.bins === 'object' ? p.bins : null) : null
  return o ? Object.entries(o).filter(([, d]) => typeof d === 'string') : []
}
/** a count: a number param (bins), or options whose values are all numbers */
const isCount = (p) => p?.type === 'number' || !!p?.bins || (optionsOf(p).length > 0 && optionsOf(p).every(([v]) => /^\d+$/.test(v)))
/** a param's default as a string (an options param without one: its first option, as defineCatalog does) */
const defaultOf = (p) => p?.default !== undefined ? String(p.default)
  : p?.options && typeof p.options === 'object' ? Object.keys(p.options)[0] : undefined

/**
 * The findings for one catalog: [{ kind: 'parts', a, b, phrase }, { kind: 'mentions', part,
 * param, option, word }, { kind: 'options', part, param, option, other, otherOption, word }].
 */
export function lintCatalog(cat) {
  const out = []
  const parts = Object.entries(cat?.parts || {}).filter(([, p]) => p && typeof p.description === 'string')

  // 'parts': a shared phrase (one finding per phrase, naming every part that has it)
  const byPhrase = new Map()
  for (const [id, p] of parts) {
    for (const [k, text] of phrases(p.description)) {
      if (!byPhrase.has(k)) byPhrase.set(k, [])
      byPhrase.get(k).push({ id, text, group: p.group ?? '#' + id })
    }
  }
  const seen = new Set()
  for (const list of byPhrase.values()) {
    if (new Set(list.map(e => e.group)).size < 2) continue
    const key = list.map(e => e.id).join(' ')
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ kind: 'parts', parts: list.map(e => e.id), phrases: list.map(e => e.text), phrase: list[0].text })
  }

  for (const [id, p] of parts) {
    const own = nameStems(id)
    const desc = content(p.description, { keepKind: true })
    const descStems = new Set(desc.map(t => t.stem))
    const params = Object.entries(p.params && typeof p.params === 'object' ? p.params : {})

    // 'mentions': the description names a value of its own params
    for (const [name, prm] of params) {
      for (const [value, odesc] of optionsOf(prm)) {
        let word = null
        // the value as a word (`month`, `paid`); numbers, filler and quantifiers never
        if (/^[A-Za-z]+$/.test(value) && value.length >= 3 && !STOP.has(value.toLowerCase()) && stem(value) !== '*all' && !own.has(stem(value))) {
          const hit = desc.find(t => t.stem === stem(value))
          if (hit) word = hit.word
        }
        if (!word) {
          const ws = content(odesc, { keepKind: true }).filter(t => !own.has(t.stem))
          const shared = [...new Set(ws.filter(t => descStems.has(t.stem)).map(t => t.word.toLowerCase()))]
          if (shared.length >= 2) word = shared.join(' ')
        }
        if (word) out.push({ kind: 'mentions', part: id, param: name, option: value, word })
      }
    }

    // 'options': two params of the part share a word in their options
    // (words of the part's own name and description are its subject, not a param's: left out;
    // two defaults never collide: either one means "not stated")
    const toks = params.map(([name, prm]) => [name, defaultOf(prm), optionsOf(prm).map(([v, d]) =>
      [v, new Set([...content(d, { keepAll: true }), ...(/^[A-Za-z]+$/.test(v) ? content(v, { keepAll: true }) : [])]
        .map(t => t.stem).filter(s => !own.has(s) && !descStems.has(s)))])])
    for (let i = 0; i < toks.length; i++) {
      for (let j = i + 1; j < toks.length; j++) {
        const [n1, d1, o1] = toks[i]
        const [n2, d2, o2] = toks[j]
        // "all" in a count's options is quantity vocabulary ("all of them": the most rows), measured
        // harmless next to a filter's "all" (params-edits OPS orders: status + limit)
        const counts = isCount(params[i][1]) || isCount(params[j][1])
        let hit = null
        for (const [v1, s1] of o1) {
          for (const [v2, s2] of o2) {
            if (v1 === d1 && v2 === d2) continue
            const w = [...s1].find(s => s2.has(s) && !(s === '*all' && counts))
            if (w) { hit = { option: v1, otherOption: v2, word: w === '*all' ? 'all / any / every' : w }; break }
          }
          if (hit) break
        }
        if (hit) out.push({ kind: 'options', part: id, param: n1, other: n2, ...hit })
      }
    }
  }
  return out
}
