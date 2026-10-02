// Starter versions (PLAN-2 4-E, G-123): what a trial dir holds besides the
// task's own starter files. The task starters (tasks/NN-slug/starter,
// react/tasks/NN-slug/starter) stay bare and match their React counterparts
// apart from the framework; a starter version adds a kit on top of them, as an
// overlay applied by prepare.mjs before `npm install` (lib/variant.mjs merges
// it under a variant's own overlay).
//
//   1  bare task starters: every run up to and including Phase 3 (PLAN-1
//      baseline/phase3, v2-baseline, p3-*, e*). No sygnal-check installed.
//   2  Sygnal arm as the 5.4.0 create-sygnal-app templates ship: sygnal-check as
//      a devDependency (this checkout's sygnal-check, packed and vendored, so it
//      matches the build under test; the templates take ^0.1.0 from npm) and
//      AGENTS.md + CLAUDE.md (`@AGENTS.md`) from starter-kits/sygnal-v2/*.tmpl: the
//      template's commands table, workflow and testing snippet. React arm
//      unchanged (Vite's React template has no AGENTS.md).
//
// Variant runs default to CURRENT_STARTER (a spec can pin `"starter": 1`);
// runs without a variant (the legacy installed-skill posture) use 1, so they
// reproduce v2-baseline. Records carry `starterVersion`; a record without it
// is starter 1. A variant on starter 1 hashes exactly as it did before starter
// versions existed, so earlier runs' variantHash values still match.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const KITS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'starter-kits')
/**
 * A kit's files: starter-kits/<kit>/<NAME>.tmpl is written as <NAME>. The
 * sources carry a .tmpl suffix so that no AGENTS.md / CLAUDE.md sits in this
 * repo, where Claude Code would load it as project memory.
 */
const kitFiles = (kit, names) => Object.fromEntries(names.map((n) => [n, fs.readFileSync(path.join(KITS, kit, `${n}.tmpl`), 'utf8')]))

/**
 * Overlays in the variant overlay format (files are inline text, so their
 * content is in the variant hash). A pack's `dir` resolves against the
 * checkout under test, like spec paths.
 */
export const STARTERS = {
  1: { description: 'bare task starters (all runs up to Phase 3)', overlay: null },
  2: {
    description: 'Sygnal arm + sygnal-check (this checkout, vendored) + AGENTS.md/CLAUDE.md, as the 5.4.0 templates',
    overlay: {
      sygnal: {
        files: kitFiles('sygnal-v2', ['AGENTS.md', 'CLAUDE.md']),
        packs: { 'sygnal-check': { dir: 'sygnal-check', dependency: 'devDependencies' } },
      },
    },
  },
}

export const CURRENT_STARTER = 2
/** Runs without a variant: the legacy posture, kept as it was. */
export const LEGACY_STARTER = 1

/** A starter version from a spec value or CLI flag; throws on an unknown one. */
export function parseStarter(x) {
  const n = typeof x === 'string' && /^v?\d+$/.test(x) ? Number(x.replace(/^v/, '')) : x
  if (!Number.isInteger(n) || !STARTERS[n]) throw new Error(`Unknown starter version ${JSON.stringify(x)} (known: ${Object.keys(STARTERS).join(', ')})`)
  return n
}
