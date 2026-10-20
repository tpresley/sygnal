/**
 * SYG429 (PLAN-13 F-3): a Switchable's per-page `state={{ page: … }}` names a key that is not one
 * of its `of` pages, so that binding is never used (and the page it meant shares the owner's
 * state). Only for an `of` object literal whose keys are all known; did-you-mean with a rename
 * fix. The dev checks report the same at run time.
 */
import { closestName } from '../names.js'
import { renameFix, keyEdit } from '../edits.js'

export default {
  id: 'switchable-state-map',
  codes: ['SYG429'],
  description: 'Switchable state map names no page',
  run(project, report) {
    const seen = new Set()
    for (const comp of project.components) {
      if (!comp.view) continue
      const sink = project.viewOf({ file: comp.file, node: comp.view })
      for (const u of sink?.collections || []) {
        if (u.kind !== 'switchable' || !u.stateMap || !u.ofKeys || seen.has(u.node)) continue
        seen.add(u.node)
        const pages = new Set(u.ofKeys)
        for (const { key, node } of u.stateMap) {
          if (pages.has(key)) continue
          const near = closestName(key, pages)
          report({
            code: 'SYG429',
            component: comp.name,
            file: u.file || comp.file,
            node,
            message: `the Switchable's state map binds '${key}', which is not one of its pages (${u.ofKeys.join(', ')}), so that binding is never used` + (near ? ` (did you mean '${near}'?)` : ''),
            fix: near ? `rename the key to the page: ${near}: …` : `use one of the page names in of={{ … }} as the key, or remove the entry`,
            data: { key, pages: u.ofKeys, ...(near ? { suggestion: near } : {}) },
            fixes: near && renameFix(`Change '${key}' to '${near}'`, keyEdit(u.file || comp.file, node, near)),
          })
        }
      }
    }
  },
}
