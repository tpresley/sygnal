// jsdom's globals include its own realm's Uint8Array, so Node's TextEncoder output fails esbuild's
// `instanceof Uint8Array` invariant (the compile step): give the tests Node's
import {TextEncoder, TextDecoder} from 'node:util'
globalThis.TextEncoder = TextEncoder
globalThis.TextDecoder = TextDecoder
globalThis.Uint8Array = new TextEncoder().encode('').constructor
