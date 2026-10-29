// sygnal-check's own findings for the prototype's codes, in the same normalized lines.
//   node run-sygnal-check.mjs <dir> [--json]
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { compact } from './common.mjs'
const src = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../sygnal-check/src')
const { check } = await import(pathToFileURL(path.join(src, 'index.js')))
const dir = path.resolve(process.argv[2])
const CODES = new Set(['SYG101', 'SYG105', 'SYG110', 'SYG302'])
const diags = check([dir], { cwd: dir })
const out = compact(diags.filter(d => CODES.has(d.code)).map(d => ({ code: d.code, file: path.relative(dir, path.resolve(dir, d.file)), line: d.line, column: d.column })))
console.log(process.argv.includes('--json') ? JSON.stringify(out) : out.join('\n'))
