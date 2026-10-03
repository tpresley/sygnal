/**
 * Test endpoints for makeSocketDriver (PLAN-3 2-A), on the Vite dev server itself, with Node
 * built-ins only (no `ws` dependency):
 *
 * - WebSocket `/__ws/echo`: echoes every text frame. The text `close-me` makes the server close
 *   the connection with code 4000, reason 'bye' (a close the client didn't make).
 * - SSE `/__sse`: each connection sends one default message `{ n }` and one `tick` event `{ n }`
 *   (n counts connections), then ends the response, so EventSource reconnects by itself
 *   (`retry: 100`).
 */
import { createHash } from 'node:crypto'

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'

function frame(op, payload = Buffer.alloc(0)) {
  const len = payload.length
  const head = len < 126 ? Buffer.from([0x80 | op, len])
    : len < 65536 ? Buffer.from([0x80 | op, 126, len >> 8, len & 255])
    : Buffer.concat([Buffer.from([0x80 | op, 127]), (() => { const b = Buffer.alloc(8); b.writeBigUInt64BE(BigInt(len)); return b })()])
  return Buffer.concat([head, payload])
}

function acceptSocket(req, socket, onText) {
  const key = req.headers['sec-websocket-key']
  const accept = createHash('sha1').update(key + GUID).digest('base64')
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' +
    `Sec-WebSocket-Accept: ${accept}\r\n\r\n`)
  const ws = {
    send: text => socket.write(frame(1, Buffer.from(text))),
    close: (code, reason) => {
      const p = Buffer.concat([Buffer.from([code >> 8, code & 255]), Buffer.from(reason)])
      socket.end(frame(8, p))
    },
  }
  let pending = Buffer.alloc(0)
  socket.on('data', chunk => {
    pending = Buffer.concat([pending, chunk])
    for (;;) {
      if (pending.length < 2) return
      const op = pending[0] & 15
      const masked = pending[1] & 128
      let len = pending[1] & 127
      let off = 2
      if (len === 126) { if (pending.length < 4) return; len = pending.readUInt16BE(2); off = 4 }
      else if (len === 127) { if (pending.length < 10) return; len = Number(pending.readBigUInt64BE(2)); off = 10 }
      const mask = masked ? pending.subarray(off, off + 4) : null
      if (masked) off += 4
      if (pending.length < off + len) return
      const payload = Buffer.from(pending.subarray(off, off + len))
      if (mask) for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3]
      pending = pending.subarray(off + len)
      if (op === 1) onText(payload.toString(), ws)
      else if (op === 8) { socket.end(frame(8, payload)); return }
      else if (op === 9) socket.write(frame(10, payload))
    }
  })
  socket.on('error', () => {})
}

export function socketTestServer() {
  let sseConnections = 0
  return {
    name: 'sygnal-socket-test-server',
    configureServer(server) {
      server.httpServer?.on('upgrade', (req, socket) => {
        if (!req.url.startsWith('/__ws/echo')) return
        acceptSocket(req, socket, (text, ws) => (text === 'close-me' ? ws.close(4000, 'bye') : ws.send(text)))
      })
      server.middlewares.use('/__sse', (req, res) => {
        const n = ++sseConnections
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
        res.write('retry: 100\n\n')
        res.write(`data: ${JSON.stringify({ n })}\n\n`)
        res.write(`event: tick\ndata: ${JSON.stringify({ n })}\n\n`)
        setTimeout(() => res.end(), 50)
      })
    },
  }
}
