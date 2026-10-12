// Selection only: one select call per case per variant; prints part errors at several thresholds.
//   node --env-file=... evals/select-sweep.mjs variantA variantB ...
import { CATALOGS } from './catalogs.mjs'
import { TEXT, selectStep, readSelect, parse, partsIn } from '../composer.mjs'
import { decide } from '../client.mjs'

const BASE = { ...TEXT }
const VARIANTS = {
  base: {},
  strict: { select: 'Is this element one of the things user_request asks to see? Choose use only when user_request names this element or describes what it shows. Choose omit for elements that are merely about the same topic, area or page as what user_request asks for.' },
  contrast: { select: BASE.select, omit: 'user_request does not ask for this element: it names neither it nor what it shows.' },
  noul: { form: 'noul' },
  strict2: { select: 'Is this element one of the things user_request asks to see? user_request may ask for several elements; check whether this one is among them. Choose use when user_request names this element or describes what it shows. Choose omit for elements that are merely about the same topic, area or page as what user_request asks for.' },
  strict3: { select: 'Is this element one of the things user_request asks to see? Choose use only when user_request names this element or describes what it shows, or names a whole area (such as "notification settings") that this element belongs to. Choose omit for elements that are merely about the same topic as what user_request asks for.' },
  vagueOk: { select: 'Does user_request ask for this element, by name or by what it shows? Every element user_request names must be used. When user_request names only an area (such as "billing" or "notification settings"), use every element of that area. Omit elements user_request does not ask for, even when related to the topic.' },
}
const names = process.argv.slice(2).filter((a) => !a.startsWith('--'))
const cats = (process.argv.find((a) => a.startsWith('--cat=')) || '--cat=dashboard,settings,crm,landing,ops').slice(6).split(',')
for (const v of names.length ? names : Object.keys(VARIANTS)) {
  Object.assign(TEXT, BASE, VARIANTS[v])
  const form = VARIANTS[v].form || 'choice'
  const rows = []
  for (const c of cats) {
    const catalog = CATALOGS[c]
    const res = await Promise.all(catalog.cases.map(async ([prompt, want]) => {
      const step = selectStep(catalog, prompt, { form })
      const r = await decide(step.state, step.questions)
      return { c, prompt, want: new Set(partsIn(parse(want), catalog)), answers: r.answers, tokens: r.tokens }
    }))
    rows.push(...res)
  }
  const line = [v]
  for (const t of [0.4, 0.5, 0.6, 0.7]) {
    let miss = 0, extra = 0, okCases = 0
    for (const r of rows) {
      const cat = CATALOGS[r.c]
      const sel = readSelect(cat, r.answers, { threshold: t })
      const got = new Set(sel.items.filter((k) => !cat.parts.find((p) => p.id === k.split('__')[0])?.required && !cat.parts.some((p) => p.companions?.includes(k))))
      const want = new Set([...r.want].filter((k) => !cat.parts.find((p) => p.id === k)?.required && !cat.parts.some((p) => p.companions?.includes(k))))
      const m = [...want].filter((x) => !got.has(x)).length, e = [...got].filter((x) => !want.has(x)).length
      miss += m; extra += e; if (!m && !e) okCases++
      if (process.argv.includes('--v') && t === 0.5 && (m || e)) console.log(`  [${r.c}] ${r.prompt}: missing ${[...want].filter((x) => !got.has(x))} extra ${[...got].filter((x) => !want.has(x))}`)
    }
    line.push(`t=${t}: ${okCases}/${rows.length} sets ok, ${miss} missing, ${extra} extra`)
  }
  console.log(line.join(' | '), `| ${Math.round(rows.reduce((a, r) => a + r.tokens, 0) / rows.length)} tok`)
}
