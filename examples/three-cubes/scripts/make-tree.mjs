// Writes public/models/tree.glb: a small low-poly tree (a cone of leaves on a trunk), self-made
// and CC0. The geometry comes from three's own classes; the GLB (glTF 2.0 binary) is packed by
// hand, so the script needs nothing but three: node scripts/make-tree.mjs
import { writeFileSync } from 'node:fs'
import { ConeGeometry, CylinderGeometry } from 'three'

const parts = [
  { name: 'trunk', geometry: new CylinderGeometry(0.12, 0.16, 0.5, 7).translate(0, 0.25, 0), color: [0.42, 0.26, 0.15] },
  { name: 'leaves', geometry: new ConeGeometry(0.55, 1.1, 7).translate(0, 1.0, 0), color: [0.18, 0.62, 0.33] },
]

const chunks = [], bufferViews = [], accessors = [], meshes = [], materials = [], nodes = []
let offset = 0
const view = (array, target) => {
  const bytes = Buffer.from(array.buffer, array.byteOffset, array.byteLength)
  bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: bytes.length, target })
  chunks.push(bytes)
  offset += bytes.length
  const pad = (4 - (offset % 4)) % 4
  if (pad) chunks.push(Buffer.alloc(pad)), offset += pad
  return bufferViews.length - 1
}
for (const { name, geometry, color } of parts) {
  const pos = geometry.attributes.position.array, nor = geometry.attributes.normal.array
  const index = new Uint16Array(geometry.index.array)
  const min = [0, 1, 2].map((a) => Math.min(...pos.filter((_, i) => i % 3 == a)))
  const max = [0, 1, 2].map((a) => Math.max(...pos.filter((_, i) => i % 3 == a)))
  accessors.push({ bufferView: view(new Float32Array(pos), 34962), componentType: 5126, count: pos.length / 3, type: 'VEC3', min, max })
  accessors.push({ bufferView: view(new Float32Array(nor), 34962), componentType: 5126, count: nor.length / 3, type: 'VEC3' })
  accessors.push({ bufferView: view(index, 34963), componentType: 5123, count: index.length, type: 'SCALAR' })
  const a = accessors.length - 3
  materials.push({ name, pbrMetallicRoughness: { baseColorFactor: [...color, 1], metallicFactor: 0, roughnessFactor: 0.8 } })
  meshes.push({ name, primitives: [{ attributes: { POSITION: a, NORMAL: a + 1 }, indices: a + 2, material: materials.length - 1 }] })
  nodes.push({ name, mesh: meshes.length - 1 })
}
nodes.push({ name: 'tree', children: nodes.map((_, i) => i) })
const bin = Buffer.concat(chunks)
const gltf = {
  asset: { version: '2.0', generator: 'sygnal three-cubes make-tree.mjs', copyright: 'CC0 1.0' },
  scene: 0, scenes: [{ nodes: [nodes.length - 1] }], nodes, meshes, materials, accessors, bufferViews,
  buffers: [{ byteLength: bin.length }],
}
let json = Buffer.from(JSON.stringify(gltf))
json = Buffer.concat([json, Buffer.alloc((4 - (json.length % 4)) % 4, 0x20)])
const header = Buffer.alloc(12), jh = Buffer.alloc(8), bh = Buffer.alloc(8)
header.write('glTF', 0); header.writeUInt32LE(2, 4); header.writeUInt32LE(12 + 8 + json.length + 8 + bin.length, 8)
jh.writeUInt32LE(json.length, 0); jh.write('JSON', 4)
bh.writeUInt32LE(bin.length, 0); bh.write('BIN\0', 4)
const out = new URL('../public/models/tree.glb', import.meta.url)
writeFileSync(out, Buffer.concat([header, jh, json, bh, bin]))
console.log(`wrote ${out.pathname} (${12 + 16 + json.length + bin.length} bytes)`)
