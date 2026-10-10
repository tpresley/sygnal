/**
 * The language server's wire layer (PLAN-7 L-1): LSP base protocol framing and JSON-RPC 2.0,
 * hand-written like src/mcp.js so sygnal-check keeps `@babel/parser` as its only dependency
 * (D298).
 *
 * A message is `Content-Length: <bytes>\r\n` (other headers such as Content-Type are read and
 * ignored) `\r\n` then a UTF-8 JSON body.
 *
 *   createReader(input, { onMessage, onError, onEnd })   parse frames from a Readable
 *     onMessage(msg)          one parsed body (any JSON value; the server validates it)
 *     onError(kind, detail)   'header' (no Content-Length: the header block is skipped) or
 *                             'parse' (a body that isn't JSON: the server answers -32700)
 *     onEnd()                 the stream ended or closed (the server exits: Claude Code never
 *                             sends `exit`, 0-S2)
 *   createWriter(output)  → write(msg)   (adds `jsonrpc: '2.0'`; never throws once the output
 *                             is gone)
 *   uriToPath(uri) / pathToUri(path)   file: URIs ⇄ absolute paths (null for other schemes)
 *   ErrorCodes                          the JSON-RPC and LSP error codes the server answers with
 */
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const ErrorCodes = Object.freeze({
  ParseError: -32700,
  InvalidRequest: -32600,
  MethodNotFound: -32601,
  InvalidParams: -32602,
  InternalError: -32603,
  ServerNotInitialized: -32002,
  RequestCancelled: -32800,
})

const SEP = Buffer.from('\r\n\r\n')

export function createReader(input, { onMessage, onError = () => {}, onEnd = () => {} }) {
  let buf = Buffer.alloc(0)
  let ended = false
  const end = () => {
    if (ended) return
    ended = true
    onEnd()
  }
  input.on('data', (chunk) => {
    buf = buf.length ? Buffer.concat([buf, Buffer.from(chunk)]) : Buffer.from(chunk)
    for (;;) {
      const sep = buf.indexOf(SEP)
      if (sep < 0) return
      const header = buf.subarray(0, sep).toString('ascii')
      const m = /(?:^|\r\n)content-length:\s*(\d+)/i.exec(header)
      if (!m) {
        // not a frame we understand: drop the header block and resynchronise on the next one
        buf = buf.subarray(sep + SEP.length)
        onError('header', header)
        continue
      }
      const len = Number(m[1])
      const start = sep + SEP.length
      if (buf.length < start + len) return
      const body = buf.subarray(start, start + len).toString('utf8')
      buf = buf.subarray(start + len)
      let msg
      try {
        msg = JSON.parse(body)
      } catch (err) {
        onError('parse', err?.message || String(err))
        continue
      }
      onMessage(msg)
    }
  })
  input.on('end', end)
  input.on('close', end)
  input.on('error', end)
}

export function createWriter(output) {
  let broken = false
  output.on?.('error', () => { broken = true })
  return function write(msg) {
    if (broken) return
    const body = JSON.stringify({ jsonrpc: '2.0', ...msg })
    try {
      output.write(`Content-Length: ${Buffer.byteLength(body, 'utf8')}\r\n\r\n${body}`)
    } catch {
      broken = true
    }
  }
}

export function uriToPath(uri) {
  if (typeof uri !== 'string' || !uri.startsWith('file:')) return null
  try {
    return path.normalize(fileURLToPath(uri))
  } catch {
    return null
  }
}

export function pathToUri(file) {
  return pathToFileURL(file).href
}

/** An error a request handler throws to answer with a specific code. */
export class ResponseError extends Error {
  constructor(code, message, data) {
    super(message)
    this.code = code
    this.data = data
  }
}
