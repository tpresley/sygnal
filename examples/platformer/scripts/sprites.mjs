// Writes src/sprites.png, the game's sprite sheet: 16 × 16 pixel-art frames drawn from the ASCII
// below (one character a pixel, '.' transparent), 8 to a row. Original art, no third-party assets.
//   node scripts/sprites.mjs
import {deflateSync} from 'node:zlib'
import {writeFileSync} from 'node:fs'

const PALETTE = {
  k: '#1d2340', r: '#e8603c', R: '#ff8a5c', s: '#ffd9b0', e: '#1d2340', w: '#ffffff', b: '#2d3a8c', B: '#4656b8',
  g: '#3fae3a', G: '#7fdc5a', p: '#9b6ad6', P: '#c49cf0', d: '#3a2357', h: '#2fae6b', H: '#7fe0a8', n: '#11402a',
  f: '#3d8fe0', F: '#8cc4ff', l: '#d6ecff', L: '#6a9cc8',
}

const player = (legs) => [
  '.......gG.......',
  '......gGg.......',
  '.......g........',
  '....krrrrrrk....',
  '...krRRrrrrrk...',
  '...krrrrrrrrrrk.',
  '....kssssssk....',
  '....ksssewsek...',
  '....kssssssk....',
  '...kbbbbbbbbk...',
  '..ksbBbbbbbbsk..',
  '...kbbbbbbbbk...',
  '...kbbbbbbbbk...',
  ...legs,
]
const FRAMES = [
  // 0 player standing, 1–2 running, 3 jumping (facing right)
  player(['....kbbkkbbk....', '....kkk..kkk....', '...kkkk..kkkk...']),
  player(['...kbbk..kbbk...', '..kkkk....kkk...', '..kkk......kk...']),
  player(['.....kbbbbk.....', '.....kkkkkk.....', '....kkkk.kk.....']),
  player(['..kbbk....kbbk..', '.kkkk......kkk..', '.kkk........k...']),
  // 4–5 walker (facing left), 6 squashed
  ['................', '................', '.....kkkkkk.....', '...kkppppppkk...', '..kpPPppppppk...', '.kpwwpppppppk...', '.kpwekppppppkk..', '.kpwwppppppppk..', '.kppppppppppppk.', 'kpppppppppppppk.', 'kpppppppppppppk.', '.kpppppppppppk..', '..kkkkkkkkkkk...', '..kddk...kddk...', '.kddddk.kddddk..', '.kkkkkk.kkkkkk..'],
  ['................', '................', '.....kkkkkk.....', '...kkppppppkk...', '..kpPPppppppk...', '.kpwwpppppppk...', '.kpwekppppppkk..', '.kpwwppppppppk..', '.kppppppppppppk.', 'kpppppppppppppk.', 'kpppppppppppppk.', '.kpppppppppppk..', '..kkkkkkkkkkk...', '...kddk..kddk...', '..kddddkkddddk..', '..kkkkkkkkkkkk..'],
  ['................', '................', '................', '................', '................', '................', '................', '................', '................', '................', '................', '...kkkkkkkkkk...', '.kkppppppppppkk.', 'kpPPpppppppppppk', 'kppppppppppppppk', '.kkkkkkkkkkkkkk.'],
  // 7 hopper, 8 squashed
  ['................', '................', '...kkk....kkk...', '..kwwek..kwwek..', '..kwwwkkkkwwwk..', '.khhhhhhhhhhhhk.', 'khHHhhhhhhhhhhhk', 'khHhhhhhhhhhhhhk', 'khhhnnnnnnnnhhhk', 'khhhhhhhhhhhhhhk', 'khhhhhhhhhhhhhhk', '.khhhhhhhhhhhhk.', '..khhhhhhhhhhk..', '.khhhk....khhhk.', 'khhhhk....khhhhk', 'kkkkk......kkkkk'],
  ['................', '................', '................', '................', '................', '................', '................', '................', '................', '................', '................', '..kkkkkkkkkkkk..', '.khHHhhhhhhhhhk.', 'khhhhhhhhhhhhhhk', 'khhhhhhhhhhhhhhk', '.kkkkkkkkkkkkkk.'],
  // 9–10 flyer (wings up, down; facing left)
  ['...klllk........', '..kllLllk.......', '..kllLLllk......', '...kllLllk......', '....kkkkkkk.....', '...kffffffkk....', '..kfFFffffffk...', '.kfwwfffffffk...', '.kfwekfffffffk..', '.kfwwffffffffk..', '.kffffffffffffk.', '..kffffffffffk..', '...kkkkkkkkkk...', '................', '................', '................'],
  ['................', '................', '................', '................', '....kkkkkkk.....', '...kffffffkk....', '..kfFFffffffk...', '.kfwwfffffffk...', '.kfwekfffffffk..', '.kfwwfkkkkkffk..', '.kffkllllllkfk..', '..kkllLLLlllk...', '...kllLLllk.....', '....kllllk......', '.....kkkk.......', '................'],
]

const SIZE = 16, COLS = 8, ROWS = Math.ceil(FRAMES.length / COLS), W = SIZE * COLS, H = SIZE * ROWS
const px = Buffer.alloc(W * H * 4)
FRAMES.forEach((rows, i) => {
  if (rows.length != SIZE || rows.some(r => r.length != SIZE)) throw new Error(`frame ${i} is not ${SIZE} × ${SIZE}`)
  const ox = (i % COLS) * SIZE, oy = Math.floor(i / COLS) * SIZE
  rows.forEach((row, y) => [...row].forEach((ch, x) => {
    if (ch == '.') return
    const hex = PALETTE[ch]
    if (!hex) throw new Error(`frame ${i}: no colour for '${ch}'`)
    const o = ((oy + y) * W + ox + x) * 4
    px[o] = parseInt(hex.slice(1, 3), 16); px[o + 1] = parseInt(hex.slice(3, 5), 16); px[o + 2] = parseInt(hex.slice(5, 7), 16); px[o + 3] = 255
  }))
})

// PNG: RGBA, 8 bits, each row with filter 0
const CRC = Array.from({length: 256}, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0 })
const crc = (b) => { let c = 0xffffffff; for (const x of b) c = CRC[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0 }
const chunk = (type, data) => {
  const len = Buffer.alloc(4), body = Buffer.concat([Buffer.from(type), data]), sum = Buffer.alloc(4)
  len.writeUInt32BE(data.length); sum.writeUInt32BE(crc(body))
  return Buffer.concat([len, body, sum])
}
const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 6
const raw = Buffer.concat(Array.from({length: H}, (_, y) => Buffer.concat([Buffer.from([0]), px.subarray(y * W * 4, (y + 1) * W * 4)])))
const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, {level: 9})), chunk('IEND', Buffer.alloc(0))])
writeFileSync(new URL('../src/sprites.png', import.meta.url), png)
console.log(`src/sprites.png: ${FRAMES.length} frames, ${W} × ${H}, ${png.length} B`)
