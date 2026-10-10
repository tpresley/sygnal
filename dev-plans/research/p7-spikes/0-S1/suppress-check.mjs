#!/usr/bin/env node
/**
 * Spike 0-S1: a `sygnal-ignore` comment written above the line a finding used to start on
 * must still suppress it after C-2 narrows the node (SYG731 moves from `<button` to its
 * className line, SYG152 from `{` to `messages`, SYG422 from `{` to `every: 0`).
 * Copies the probe with the comments added and checks those codes are gone.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const repo = path.resolve(here, '../../../..')
const { checkFiles } = await import(path.join(repo, 'sygnal-check/src/index.js'))

const src = fs.readFileSync(path.join(here, 'probe/src/App.jsx'), 'utf8')
  .replace("      <button\n        type=\"button\"\n        className={state.starred", "      {/* sygnal-ignore SYG731 */}\n      <button\n        type=\"button\"\n        className={state.starred")
  .replace('    LLM: (state) => ({', '    // sygnal-ignore SYG152\n    LLM: (state) => ({')
  .replace('  tick: state.starred && {', '  // sygnal-ignore SYG422\n  tick: state.starred && {')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'syg-0s1-'))
try {
  fs.writeFileSync(path.join(tmp, 'App.jsx'), src)
  fs.copyFileSync(path.join(here, 'probe/src/main.js'), path.join(tmp, 'main.js'))
  const d = checkFiles([path.join(tmp, 'App.jsx'), path.join(tmp, 'main.js')], { cwd: tmp })
  const left = d.filter(x => ['SYG731', 'SYG152', 'SYG422'].includes(x.code)).map(x => `${x.code}:${x.line}`)
  // the second SYG422 (pulse, no comment) must stay
  const ok = left.length === 1 && left[0].startsWith('SYG422')
  console.log(ok ? 'ok: old-anchor suppressions still match' : `FAIL: still reported: ${left.join(', ')}`)
  process.exitCode = ok ? 0 : 1
} finally {
  fs.rmSync(tmp, { recursive: true, force: true })
}
