// medians across rounds (the JSON reports in a folder) per framework: busy median per scenario
import fs from 'node:fs'
const dir = process.argv[2], by = {}
for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.json'))) { const j = JSON.parse(fs.readFileSync(dir + '/' + f)); (by[j.framework] ||= []).push(j) }
const med = (a) => { a = a.slice().sort((x, y) => x - y); return a.length % 2 ? a[(a.length - 1) / 2] : (a[a.length / 2 - 1] + a[a.length / 2]) / 2 }
const f1 = (x) => x.toFixed(1)
for (const [fw, rs] of Object.entries(by)) {
  console.log(`\n${fw} (${rs.length} rounds)`)
  for (const n of [1000, 5000, 10000]) {
    const d = (sel) => med(rs.map(r => r.drag.find(x => x.shapes == n && x.selection == sel).busy.median))
    const dp = (sel) => med(rs.map(r => r.drag.find(x => x.shapes == n && x.selection == sel).busy.p95))
    const pan = med(rs.map(r => r.pan.find(x => x.shapes == n).busy.median)), zoom = med(rs.map(r => r.zoom.find(x => x.shapes == n).busy.median))
    const drop = med(rs.map(r => r.drag.find(x => x.shapes == n && x.selection == 'all').dropMs))
    console.log(`${n}: drag1 ${f1(d(1))} (${f1(dp(1))}) drag100 ${f1(d(100))} (${f1(dp(100))}) dragAll ${f1(d('all'))} (${f1(dp('all'))}) pan ${f1(pan)} zoom ${f1(zoom)} dropAll ${Math.round(drop)}`)
  }
  // (a run with --only=drag,pan,zoom has no startup, heap or generate)
  if (rs[0].startup) console.log('startup', f1(med(rs.map(r => r.startup.readyMs.median))), 'heap', rs[0].heap.map(h => h.usedMB).join('/'), 'gen10k', f1(med(rs.map(r => r.generate.find(g => g.shapes == 10000).ms))), 'overhead', f1(med(rs.map(r => r.overheadMs.busy.median))))
}
