// The lite per-file rules (SYG101, SYG110 lite, SYG302) as an oxlint JS plugin (ESLint plugin API).
// SYG105 is project-wide and has no place in a per-file lint API (see README "oxlint route").
//   oxlint -c .oxlintrc.json <dir>
import { fileFacts, rules } from '../lite/facts-estree.mjs'

const rule = (code) => ({
  meta: { type: 'problem', docs: { description: `sygnal-check ${code} (lite)` } },
  create(context) {
    return {
      'Program:exit'(program) {
        const found = rules(new Map([['', fileFacts(program)]]))
        for (const d of found) if (d.code === code) context.report({ node: d.node, message: `${code} ${d.message || ''}` })
      },
    }
  },
})

export default {
  meta: { name: 'sygnal-lite' },
  rules: { syg101: rule('SYG101'), syg110: rule('SYG110'), syg302: rule('SYG302') },
}
