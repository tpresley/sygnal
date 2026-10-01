#!/usr/bin/env node
// Prepare one trial directory (step 1 of run.md).
//
// Usage:
//   node evals/agent-ergonomics/prepare.mjs --arm sygnal|react --task 03 --dest <dir>
//        [--tarball <sygnal.tgz>] [--build] [--no-install] [--variant-spec <prepare.json>]
//
// - Copies tasks/<task>/starter (or react/tasks/<task>/starter) to <dest>.
// - Sygnal arm: packs this repo's Sygnal build (or uses --tarball) and puts it
//   at <dest>/vendor/sygnal.tgz, which the starter's package.json depends on
//   via "file:vendor/sygnal.tgz". Nothing in <dest> points back into the repo.
// - --variant-spec (written by orchestrate.mjs --variant, lib/variant.mjs):
//   applies the arm's starter overlay (files, package.json merge, vendored
//   packages) before the install, and the prompt prefix/suffix.
// - Runs `npm install` so the agent starts with a working app.
// - Runs a leak check and writes <dest>/../<basename>.prompt.txt containing the
//   exact prompt to hand to the agent.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  REPO_ROOT, armPaths, resolveTask, parseArgs, copyDir, npm, packSygnal, leakCheck,
} from './lib/common.mjs'
import { applyOverlay, applyPrompt } from './lib/variant.mjs'

const args = parseArgs(process.argv.slice(2))
if (!args.arm || !args.task || !args.dest) {
  console.error('usage: prepare.mjs --arm sygnal|react --task <id> --dest <dir> [--tarball f.tgz] [--build] [--no-install] [--variant-spec prepare.json]')
  process.exit(2)
}
const arm = args.arm
const task = resolveTask(arm, args.task)
const dest = path.resolve(args.dest)

if ((dest + path.sep).startsWith(REPO_ROOT + path.sep)) {
  console.error(`--dest must be outside the repository (${REPO_ROOT}); the agent must not be able to find hidden/.`)
  process.exit(2)
}
if (fs.existsSync(dest) && fs.readdirSync(dest).length > 0) {
  console.error(`${dest} exists and is not empty`)
  process.exit(2)
}

const { tasks } = armPaths(arm)
copyDir(path.join(tasks, task, 'starter'), dest)

if (arm === 'sygnal') {
  const tarball = args.tarball
    ? path.resolve(args.tarball)
    : packSygnal(fs.mkdtempSync(path.join(os.tmpdir(), 'sygnal-pack-')), { build: !!args.build })
  fs.mkdirSync(path.join(dest, 'vendor'), { recursive: true })
  fs.copyFileSync(tarball, path.join(dest, 'vendor', 'sygnal.tgz'))
}

const variant = typeof args['variant-spec'] === 'string' ? JSON.parse(fs.readFileSync(args['variant-spec'], 'utf8')).arms?.[arm] ?? null : null
if (variant?.overlay) {
  const touched = applyOverlay(dest, variant.overlay)
  console.error(`[prepare] variant overlay: ${touched.join(', ')}`)
}

if (!args['no-install']) {
  console.error(`[prepare] npm install in ${dest} ...`)
  npm(['install', '--no-audit', '--no-fund', '--loglevel=error'], dest)
}

const leaks = leakCheck(dest)
if (leaks.length) {
  console.error('[prepare] LEAK CHECK FAILED:\n  ' + leaks.join('\n  '))
  process.exit(1)
}

const promptText = applyPrompt(fs.readFileSync(path.join(tasks, task, 'PROMPT.md'), 'utf8').trim(), variant?.prompt)
const skillLine =
  arm === 'sygnal'
    ? '\n\nThis app uses the Sygnal framework. Use the sygnal-dev skill.'
    : ''
const agentPrompt =
  `${promptText}${skillLine}\n\n` +
  `The app is in ${dest}. Work only inside that directory. ` +
  'You can run `npm run build` and `npm test` there.'
const promptFile = path.join(path.dirname(dest), `${path.basename(dest)}.prompt.txt`)
fs.writeFileSync(promptFile, agentPrompt + '\n')

console.log(JSON.stringify({ arm, task, dest, promptFile }, null, 2))
