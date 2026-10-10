// node vscode/test/compare.mjs: one line per mode from ../logs/vscode-<mode>.{results,summary}.json
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const logs = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../logs')
for (const m of ['both', 'push', 'pull']) {
  const rf = path.join(logs, `vscode-${m}.results.json`), sf = path.join(logs, `vscode-${m}.summary.json`)
  if (!fs.existsSync(rf)) continue
  const r = JSON.parse(fs.readFileSync(rf)), s = JSON.parse(fs.readFileSync(sf))
  console.log(`=== ${m}`, JSON.stringify({
    sygnalShownC: r.diagnosticsC.filter(d => d.source === 'sygnal').length, unopened: r.diagnosticsUnopened,
    quickfixes: r.codeActions.filter(a => /Change/.test(a.title)).map(a => a.title), fixAll: r.fixAllActions.map(a => a.kind),
    afterFix: r.afterUnsavedFix.cleared, newFileD: r.newFileOnDisk.diagnosticsForD.length, done: r.done,
    pulls: s.pulls.length, pullUris: [...new Set(s.pulls.map(p => p.uri))], cancels: s.cancels.map(c => c.method),
    watched: s.watchedFileEvents.length, cfgReqs: s.configurationRequests.map(c => c.response), didChangeCfg: s.didChangeConfiguration,
    data: s.dataSurvives, cdesc: s.codeDescriptionSurvives, rel: s.relatedInfoSurvives,
    notes: s.notes.map(n => n.text + ' ' + JSON.stringify(n.res ?? '')), unhandled: [...new Set(s.unhandled)],
  }, null, 1))
}
