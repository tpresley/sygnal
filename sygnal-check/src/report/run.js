/**
 * The behaviour report for two versions of an app (the CLI's --report, the MCP `report` tool).
 *
 *   runReport({ base, head?, cwd, files, paths, settings, extraDiagnostics?, refOptions, stderr, shown? }) → BehaviourReport
 *     files, paths, settings: the head's (expandInputs, resolveOptions); head: a ref, else the
 *     working tree; refOptions: what refGraph reads for the commits. Throws GitBaseError.
 */
import path from 'node:path'
import { graphFiles } from '../graph.js'
import { refGraph, changedPaths } from '../gitBase.js'
import { behaviourFacts, appDrivers } from './facts.js'
import { behaviourReport } from './compare.js'

function side() {
  const s = { graph: null, facts: null, parseErrors: [], apps: [] }
  s.onProject = (project, graph) => {
    s.graph = graph
    s.facts = behaviourFacts(project, graph)
    s.apps = appDrivers(project)
    s.parseErrors = project.parseErrors.map(e => project.relPath(e.file))
  }
  return s
}

export function runReport({ base: baseRef, head: headRef, cwd, files, paths, settings, extraDiagnostics, refOptions, stderr, shown = (p) => path.isAbsolute(p) ? (path.relative(cwd, p) || '.') : p }) {
  const base = side(), head = side()
  const ctx = { cwd, stderr, shown }
  const b = refGraph(refOptions, paths, ctx, { ref: baseRef, onProject: base.onProject })
  if (headRef !== undefined) refGraph(refOptions, paths, ctx, { ref: headRef, onProject: head.onProject })
  else graphFiles(files, { cwd, strict: settings.strict, a11y: settings.a11y, ignore: settings.ignore, includeTests: settings.includeTests, replyKeys: settings.replyKeys, extraDiagnostics, onProject: head.onProject })
  return behaviourReport(base, head, { base: baseRef, head: headRef ?? 'working tree', commit: b.commit, changedFiles: changedPaths(b.commit, headRef, paths, { cwd }) })
}
