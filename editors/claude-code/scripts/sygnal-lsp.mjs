#!/usr/bin/env node
// The Claude Code plugin's language server launcher.
//
// It runs the project's own sygnal-check language server: the copy `npx --no-install sygnal-check lsp`
// would run, found the same way (node_modules from the working directory up), never downloaded.
// It runs it in this process through the package's documented API, `runLspServer()` (what
// `bin/sygnal-check.js lsp` calls), so no second process is started.
//
// When the project has no sygnal-check, one without the language server (0.3.x and older), or one
// older than 0.11.0 (the first that knows Sygnal 7's reducer timing) in a project with Sygnal 7 or
// later installed, it prints one line on stderr and answers as an empty language server until its stdin closes: no
// capabilities, no diagnostics. Claude Code then sees a healthy server, so it doesn't log a failed
// start and retry on every edit, and the model gets nothing (the plugin's skill works regardless).
//
// SYGNAL_LSP_PROJECT overrides the directory the lookup starts from (default: the working directory,
// which Claude Code sets to the project).
import { createRequire } from 'node:module'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'

const MISSING = 'sygnal: no compatible sygnal-check with a language server (>= 0.4.0; >= 0.11.0 for Sygnal 7) in this project, so Sygnal diagnostics are off for this session. Install it with `npm install -D sygnal-check` and start a new session.'
const OUTDATED = version => `sygnal: this project has Sygnal 7 but sygnal-check ${version}, which predates Sygnal 7's reducer timing (>= 0.11.0 needed), so Sygnal diagnostics are off for this session. Install it with \`npm install -D sygnal-check@^0.11.0\` and start a new session.`

/** The project's sygnal-check entry module, or null when it isn't installed. */
export function findSygnalCheck(from = process.cwd()) {
  try {
    return createRequire(path.join(path.resolve(from), 'noop.js')).resolve('sygnal-check')
  } catch {
    return null
  }
}

const readJson = file => { try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return null } }
const major = version => { const m = /^(\d+)\.\d+\.\d+(?:[+-].*)?$/.exec(version ?? ''); return m ? +m[1] : null }

/** The installed sygnal's major version, found as sygnal-check finds it: the nearest
 * node_modules/sygnal/package.json from the project up (or a sygnal checkout itself); null when unknown. */
export function installedSygnalMajor(from = process.cwd()) {
  for (let dir = path.resolve(from); ; dir = path.dirname(dir)) {
    for (const file of [path.join(dir, 'node_modules/sygnal/package.json'), path.join(dir, 'package.json')]) {
      const pkg = readJson(file)
      if (pkg?.name === 'sygnal' && typeof pkg.version === 'string') return major(pkg.version)
    }
    if (path.dirname(dir) === dir) return null
  }
}

/** The version of the sygnal-check package an entry module belongs to, or null. */
export function checkVersion(entry) {
  for (let dir = path.dirname(entry); ; dir = path.dirname(dir)) {
    const pkg = readJson(path.join(dir, 'package.json'))
    if (pkg?.name === 'sygnal-check') return typeof pkg.version === 'string' ? pkg.version : null
    if (path.dirname(dir) === dir) return null
  }
}

/** Check metadata before importing a workspace copy. A checker before 0.11.0 does not know Sygnal 7's
 * reducer timing (outputs get the committed state), so it is refused when the project has Sygnal 7+;
 * with Sygnal 6 or an unknown version it is the right checker for the project. */
export function compatibleCheck(entry, project = process.cwd()) {
  const m = /^(\d+)\.(\d+)\.(\d+)(?:([+-]).*)?$/.exec(checkVersion(entry) ?? '')
  const current = !!m && (+m[1] > 0 || +m[2] > 11 || +m[2] === 11 && (+m[3] > 0 || m[4] !== '-'))
  return current || !(installedSygnalMajor(project) >= 7)
}

/** A language server on stdin/stdout that offers nothing: answers initialize and shutdown, exits on exit or stdin end. */
export function runEmptyServer({ input = process.stdin, output = process.stdout, name = 'sygnal (inactive)' } = {}) {
  return new Promise(resolve => {
    let buffer = Buffer.alloc(0)
    let done = false
    const finish = code => { if (!done) { done = true; resolve(code) } }
    const send = message => {
      const body = Buffer.from(JSON.stringify({ jsonrpc: '2.0', ...message }), 'utf8')
      output.write(`Content-Length: ${body.length}\r\n\r\n`)
      output.write(body)
    }
    const handle = message => {
      if (message.id === undefined || message.id === null) {
        if (message.method === 'exit') finish(0)
        return // notifications (didOpen, didChange, $/…) are ignored
      }
      if (message.method === 'initialize') send({ id: message.id, result: { capabilities: {}, serverInfo: { name } } })
      else if (message.method === 'shutdown') send({ id: message.id, result: null })
      else send({ id: message.id, error: { code: -32601, message: `${name}: ${message.method} is not supported` } })
    }
    input.on('data', chunk => {
      buffer = Buffer.concat([buffer, chunk])
      for (;;) {
        const end = buffer.indexOf('\r\n\r\n')
        if (end === -1) return
        const header = buffer.subarray(0, end).toString('ascii')
        const match = /content-length:\s*(\d+)/i.exec(header)
        if (!match) { buffer = buffer.subarray(end + 4); continue }
        const length = Number(match[1])
        if (buffer.length < end + 4 + length) return
        const body = buffer.subarray(end + 4, end + 4 + length).toString('utf8')
        buffer = buffer.subarray(end + 4 + length)
        let message
        try { message = JSON.parse(body) } catch { continue }
        handle(message)
      }
    })
    input.on('end', () => finish(0))
    input.on('close', () => finish(0))
  })
}

/** Run the project's language server, or the empty one. Resolves to the exit code. */
export async function main({ project = process.env.SYGNAL_LSP_PROJECT || process.cwd(), stderr = process.stderr } = {}) {
  const entry = findSygnalCheck(project)
  let runLspServer
  if (entry && !compatibleCheck(entry, project)) {
    stderr.write(`${OUTDATED(checkVersion(entry))}\n`)
    return runEmptyServer()
  }
  if (entry) {
    try {
      ;({ runLspServer } = await import(pathToFileURL(entry).href))
    } catch (error) {
      stderr.write(`sygnal: could not load sygnal-check from ${entry}: ${error?.message ?? error}\n`)
    }
  }
  if (typeof runLspServer === 'function') return runLspServer({ cwd: path.resolve(project) })
  stderr.write(`${MISSING}\n`)
  return runEmptyServer()
}

const real = file => { try { return fs.realpathSync(file) } catch { return path.resolve(file) } }
const invoked = Boolean(process.argv[1]) && real(process.argv[1]) === real(fileURLToPath(import.meta.url))
if (invoked) process.exit(await main())
