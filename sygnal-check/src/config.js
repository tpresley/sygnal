/**
 * The shared config file (PLAN-7 C-5): what the CLI, the MCP server, the language server
 * and sygnal/vite's `check` option read, so they all check with the same settings.
 *
 *   sygnal-check.config.json            { "strict": true, "ignore": ["SYG105"] }
 *   package.json                        { "sygnal-check": { "strict": true } }
 *
 * Keys: strict (boolean), a11y ('warn' | 'error'), ignore (codes), paths (files, directories or
 * globs, relative to the file's directory; default ['src']), includeTests (boolean). `$schema` is
 * allowed and ignored. JSON only: no JS config is ever evaluated.
 *
 * Precedence, highest first: explicit options (CLI flags, API options, editor settings), the
 * file, `defaults` (a caller's fallbacks, e.g. sygnal/vite's from `diagnostics`), DEFAULTS.
 *
 * Discovery (loadConfig without `file`): from `cwd` up to the first directory that has a
 * `sygnal-check.config.json` or a `package.json`, and no further (the project root; a config in
 * a parent directory of a package is not used). In that directory the config file wins over the
 * package.json key (an info finding says the key is ignored).
 *
 * Problems are findings, never exceptions: malformed JSON is one SYG900 on the file (with the
 * parser's position), an unknown key or a wrong type a SYG900 warning on the key ("did you
 * mean"); the bad value is dropped, and a malformed file is used as no config.
 *
 *   loadConfig(cwd, { file? }) → { config, file, diagnostics }
 *     config       the valid keys found (paths made absolute), {} when none
 *     file         absolute path of the file read, or null
 *     diagnostics  SYG900 findings (file relative to cwd)
 *   resolveOptions(options) → { options, config }
 *     options.config: false (skip the file) | a file path | undefined (discover);
 *     options.defaults: fallbacks below the file. Returns the merged options (every key set,
 *     plus the caller's other options and cwd) and loadConfig's result.
 */
import fs from 'node:fs'
import path from 'node:path'
import { makeDiagnostic } from './diagnostic.js'
import { closestName } from './names.js'

export const CONFIG_FILE = 'sygnal-check.config.json'
export const PACKAGE_KEY = 'sygnal-check'
export const DEFAULTS = Object.freeze({ strict: false, a11y: 'warn', ignore: Object.freeze([]), paths: Object.freeze(['src']), includeTests: false })
export const CONFIG_KEYS = Object.keys(DEFAULTS)
const A11Y = ['warn', 'error']
const ALLOWED = ['$schema']

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v)
const isStrings = (v) => Array.isArray(v) && v.every(s => typeof s === 'string')
const exists = (f) => { try { return fs.statSync(f).isFile() } catch { return false } }

/** The project root and the file to read: the first directory from cwd up with either file. */
function discover(cwd) {
  let dir = cwd
  for (;;) {
    const json = path.join(dir, CONFIG_FILE)
    const pkg = path.join(dir, 'package.json')
    const hasJson = exists(json)
    const hasPkg = exists(pkg)
    if (hasJson || hasPkg) return { json: hasJson ? json : null, pkg: hasPkg ? pkg : null }
    const up = path.dirname(dir)
    if (up === dir) return { json: null, pkg: null }
    dir = up
  }
}

/** 1-based line and column of a 0-based offset. */
function lineCol(text, offset) {
  const before = text.slice(0, Math.max(0, Math.min(offset, text.length)))
  const lines = before.split('\n')
  return { line: lines.length, column: lines[lines.length - 1].length + 1 }
}

/** Where `"key":` is in the text, from `from` on (the first occurrence), else the start. */
function keyAt(text, key, from = 0) {
  const re = new RegExp(JSON.stringify(key).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*:', 'g')
  re.lastIndex = from
  const m = re.exec(text)
  return m ? m.index : from
}

function readJson(file, rel, diagnostics) {
  let text
  try {
    text = fs.readFileSync(file, 'utf8')
  } catch (err) {
    diagnostics.push(problem(rel, 1, 1, `config file ${rel} could not be read (${err?.code || err?.message || err})`, 'check the path'))
    return undefined
  }
  try {
    return { text, value: JSON.parse(text.replace(/^﻿/, '')) }
  } catch (err) {
    const msg = String(err?.message || err)
    const m = /position (\d+)/.exec(msg)
    const { line, column } = lineCol(text, m ? Number(m[1]) : text.length)
    diagnostics.push(problem(rel, line, column, `${rel} is not valid JSON: ${msg.replace(/^JSON\.parse: /, '')}`,
      `fix the JSON syntax; the file is ignored until then (sygnal-check config files are JSON only)`))
    return undefined
  }
}

function problem(file, line, column, message, fix, severity = 'warn') {
  return makeDiagnostic('SYG900', { severity, file, line, column, message, fix })
}

/** Validate one config object; returns the valid keys (paths resolved against `dir`). */
function validate(obj, { text, rel, dir, offset, where }, diagnostics) {
  const config = {}
  if (!isObj(obj)) {
    const { line, column } = lineCol(text, offset)
    diagnostics.push(problem(rel, line, column, `${where} must be a JSON object, so it is ignored`, `use an object such as { "strict": true }`))
    return config
  }
  const at = (key) => lineCol(text, keyAt(text, key, offset))
  const bad = (key, message, fix) => { const { line, column } = at(key); diagnostics.push(problem(rel, line, column, message, fix)) }
  const mean = (s) => s ? ` (did you mean ${s}?)` : ''
  for (const [key, value] of Object.entries(obj)) {
    if (ALLOWED.includes(key)) continue
    if (!CONFIG_KEYS.includes(key)) {
      const near = closestName(key, CONFIG_KEYS)
      bad(key, `unknown key '${key}' in ${where}${mean(near && `'${near}'`)}, so it is ignored`, `the keys are ${CONFIG_KEYS.join(', ')}`)
      continue
    }
    if (key === 'strict' || key === 'includeTests') {
      if (typeof value === 'boolean') config[key] = value
      else bad(key, `'${key}' must be a boolean, got ${JSON.stringify(value)}${mean(value === 'true' || value === 'false' ? value : '')}, so it is ignored`, `use true or false`)
    } else if (key === 'a11y') {
      if (A11Y.includes(value)) config[key] = value
      else {
        const near = typeof value === 'string' ? closestName(value, A11Y) : null
        bad(key, `'a11y' must be 'warn' or 'error', got ${JSON.stringify(value)}${mean(near && `'${near}'`)}, so it is ignored`, `use "warn" or "error"`)
      }
    } else if (key === 'ignore') {
      if (isStrings(value)) config[key] = value.slice()
      else bad(key, `'ignore' must be an array of codes, got ${JSON.stringify(value)}, so it is ignored`, `use a list such as ["SYG105"]`)
    } else if (key === 'paths') {
      if (isStrings(value) && value.length) config[key] = value.map(p => path.resolve(dir, p))
      else bad(key, `'paths' must be a non-empty array of strings (files, directories or globs), got ${JSON.stringify(value)}, so it is ignored`, `use a list such as ["src"]`)
    }
  }
  return config
}

/** Read and validate the config for `cwd` (see the header). Never throws. */
export function loadConfig(cwd = process.cwd(), { file } = {}) {
  cwd = path.resolve(cwd)
  const diagnostics = []
  const relOf = (f) => path.relative(cwd, f) || f
  let json = null
  let pkg = null
  if (file) {
    const abs = path.resolve(cwd, file)
    if (!exists(abs)) {
      diagnostics.push(problem(file, 1, 1, `config file not found: ${file}`, 'check the path, or leave the option out to use the project\'s own config'))
      return { config: {}, file: null, diagnostics }
    }
    if (path.basename(abs) === 'package.json') pkg = abs
    else json = abs
  } else {
    ({ json, pkg } = discover(cwd))
  }

  if (json) {
    const rel = relOf(json)
    const read = readJson(json, rel, diagnostics)
    let config = {}
    if (read) config = validate(read.value, { text: read.text, rel, dir: path.dirname(json), offset: 0, where: rel }, diagnostics)
    if (pkg && !file) {
      // both: say once that the package.json key is ignored (only when it has one)
      const pkgRead = readJson(pkg, relOf(pkg), [])
      if (pkgRead && isObj(pkgRead.value) && PACKAGE_KEY in pkgRead.value) {
        const { line, column } = lineCol(pkgRead.text, keyAt(pkgRead.text, PACKAGE_KEY))
        diagnostics.push(problem(relOf(pkg), line, column,
          `the "${PACKAGE_KEY}" key in package.json is ignored: ${rel} is used instead`,
          `move the settings into ${rel} and remove the key`, 'info'))
      }
    }
    return { config, file: json, diagnostics }
  }

  if (pkg) {
    const rel = relOf(pkg)
    const read = readJson(pkg, rel, diagnostics)
    if (!read) return { config: {}, file: null, diagnostics }
    if (!isObj(read.value) || !(PACKAGE_KEY in read.value)) return { config: {}, file: null, diagnostics }
    const offset = keyAt(read.text, PACKAGE_KEY)
    const config = validate(read.value[PACKAGE_KEY], { text: read.text, rel, dir: path.dirname(pkg), offset, where: `the "${PACKAGE_KEY}" key in ${rel}` }, diagnostics)
    return { config, file: pkg, diagnostics }
  }
  return { config: {}, file: null, diagnostics }
}

/** The explicit (not undefined) values of the config keys in `opts`. */
function explicitOf(opts) {
  const out = {}
  if (!isObj(opts)) return out
  for (const k of CONFIG_KEYS) if (opts[k] !== undefined && opts[k] !== null) out[k] = opts[k]
  return out
}

/**
 * Merge explicit options, the config file, `options.defaults` and DEFAULTS (see the header).
 * `options.config`: false skips the file, a string reads that file, else discovery from cwd.
 */
export function resolveOptions(options = {}) {
  const cwd = options.cwd ? path.resolve(options.cwd) : process.cwd()
  const loaded = options.config === false
    ? { config: {}, file: null, diagnostics: [] }
    : loadConfig(cwd, { file: typeof options.config === 'string' ? options.config : undefined })
  const merged = { ...DEFAULTS, ...explicitOf(options.defaults), ...loaded.config, ...explicitOf(options) }
  const { defaults: _d, config: _c, ...rest } = options
  return { options: { ...rest, ...merged, cwd }, config: loaded }
}
