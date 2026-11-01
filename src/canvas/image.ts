/**
 * Images for sygnal/canvas: `image` nodes, loaded once per URL, and sprite sheets.
 *
 *   { type: 'image', src: '/hero.png', x, y, width, height, fit: 'contain', alt: 'Hero' }
 *   { type: 'image', x, y, width: 32, height: 32, ...frameOf(SHEET, frameAt([0, 1, 2], tick, 8)), flipX: facing < 0, smoothing: false }
 *   <Suspense fallback={<p>Loading…</p>}><Canvas>…<Image src="/map.png" x={0} y={0} /></Canvas></Suspense>
 *
 * - Data layers (images are items in `<shapes>` arrays, not tags): an image loads when a canvas
 *   first shows a layer with it, and paints once it has loaded, as an <img> does (nothing before,
 *   nothing on an error). The canvas repaints when it arrives (the cached bitmaps are painted
 *   again: the node didn't change, the pixels did) and dispatches `imageload` / `imageerror`
 *   (detail `{ src, error? }`) on its element. `preloadImage(src)` loads ahead (a title screen
 *   waits for it).
 * - `<Image src …>` (a JSX node): a control, as sygnal/three's `<Texture>`: the load starts while
 *   the view renders, `<Suspense>` shows its fallback until it has arrived, a failed load throws in
 *   the view (the component's `onError`).
 * - Cache: per URL and `crossOrigin`, shared by every canvas on the page. A canvas counts as a user
 *   while one of its layers has the image; when the last user goes (and none takes it back in the
 *   same microtask), it leaves the cache (an ImageBitmap is closed). `clearImages(src)` forgets one
 *   (a failed load is tried again).
 * - `image: source` instead of `src`: an image the app loaded or drew itself (HTMLImageElement,
 *   ImageBitmap, a canvas, a video frame): painted as it is, never cached or freed here.
 * - The crop `sx sy sw sh` (image pixels), then `fit` as CSS object-fit (`fill` default, `contain`,
 *   `cover`, `none`, `scale-down`; centred) into the box. A missing width / height is the crop's
 *   natural size (one given: the aspect ratio kept).
 */
import {__pres as pres} from '../index'

export interface ImageAsset {
  src: string
  crossOrigin: string | null
  /** 0 loading, 1 loaded, 2 failed */
  s: 0 | 1 | 2
  value?: any
  error?: Error
  promise: Promise<void>
  /** the canvases using it: told when it settles */
  users: Set<(a: ImageAsset) => void>
  /** views that rendered an <Image> placeholder for it: they render again when it settles */
  owners: Set<any>
}

const cache = new Map<string, ImageAsset>()
const keyOf = (src: string, cors?: string | null) => (cors ?? '') + ' ' + src

function load(src: string, cors: string | null): Promise<any> {
  const I = (globalThis as any).Image
  if (typeof I == 'function') return new Promise((res, rej) => {
    const img = new I()
    if (cors != null) img.crossOrigin = cors
    img.decoding = 'async'
    // decoded before its first paint: no decode on the frame that draws it
    img.onload = () => img.decode ? img.decode().then(() => res(img), () => res(img)) : res(img)
    img.onerror = () => rej(new Error('the image did not load'))
    img.src = src
  })
  // a worker: fetched and decoded into an ImageBitmap
  const g = globalThis as any
  if (typeof g.fetch == 'function' && typeof g.createImageBitmap == 'function') {
    return g.fetch(src, cors != null ? {mode: 'cors', credentials: cors == 'use-credentials' ? 'include' : 'same-origin'} : undefined)
      .then((r: any) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.blob() })
      .then((b: any) => g.createImageBitmap(b))
  }
  return Promise.reject(new Error('no image loader here (no Image, no createImageBitmap)'))
}

/** the cache entry for (src, crossOrigin), loading it the first time */
export function imageAsset(src: string, cors: string | null = null): ImageAsset {
  if (typeof src != 'string' || !src) throw new Error('an image needs a src')
  const k = keyOf(src, cors)
  let a = cache.get(k)
  if (a) return a
  a = {src, crossOrigin: cors, s: 0, users: new Set(), owners: new Set(), promise: null as any}
  cache.set(k, a)
  const A = a
  let p: Promise<any>
  try { p = load(src, cors) } catch (e) { p = Promise.reject(e) }
  A.promise = p.then(
    v => { A.value = v; A.s = 1 },
    e => { A.error = Object.assign(new Error(`could not load ${src}: ${e?.message || e}`), {cause: e}); A.s = 2 },
  ).then(() => {
    A.owners.forEach(o => o.refresh()); A.owners.clear()
    A.users.forEach(f => f(A))
  })
  return A
}

/** a canvas starts using the image (it is told when it settles) */
export function takeImage(a: ImageAsset, user: (a: ImageAsset) => void) { a.users.add(user) }
/** a canvas stops using it: the last user gone, it leaves the cache (unless taken again this microtask) */
export function releaseImage(a: ImageAsset, user: (a: ImageAsset) => void) {
  a.users.delete(user)
  if (!a.users.size) queueMicrotask(() => {
    const k = keyOf(a.src, a.crossOrigin)
    if (a.users.size || cache.get(k) !== a || a.owners.size) return
    cache.delete(k)
    a.value?.close?.()
  })
}

/** start loading ahead; resolves when it has loaded or failed */
export const preloadImage = (src: string, options: {crossOrigin?: string | null} = {}): Promise<void> => imageAsset(src, options.crossOrigin ?? null).promise

/** forget a cached image (all of them without a src): a failed load is tried again when next shown */
export function clearImages(src?: string) {
  for (const [k, a] of cache) if (src == null || a.src === src) cache.delete(k)
}

/** the asset an image node names (none for `image: source` or another type) */
export const assetOf = (n: any): ImageAsset | null => n.type == 'image' && typeof n.src == 'string' && n.src && !n.image ? imageAsset(n.src, n.crossOrigin ?? null) : null

/** what to draw for an image node now: its loaded source, or null (loading, failed, not yet complete) */
export function imageOf(n: any): any {
  const i = n.image
  if (i) return i.complete === false || (i.naturalWidth === 0 && i.complete) ? null : i
  const a = assetOf(n)
  return a && a.s == 1 ? a.value : null
}

/** a source's size in pixels */
export const natural = (i: any): [number, number] =>
  [i.naturalWidth || i.videoWidth || i.displayWidth || i.width || 0, i.naturalHeight || i.videoHeight || i.displayHeight || i.height || 0]

export type Placement = {sx: number, sy: number, sw: number, sh: number, dx: number, dy: number, dw: number, dh: number}
/** the crop, fitted into the node's box (CSS object-fit, centred): drawImage's nine arguments, or null when nothing shows */
export function placement(n: any, img: any): Placement | null {
  const [W, H] = natural(img)
  if (!W || !H) return null
  let sx = n.sx ?? 0, sy = n.sy ?? 0, sw = n.sw ?? W - sx, sh = n.sh ?? H - sy
  if (sw <= 0 || sh <= 0) return null
  let dw = n.width ?? (n.height != null ? n.height * sw / sh : sw), dh = n.height ?? (n.width != null ? n.width * sh / sw : sh), dx = n.x, dy = n.y
  const fit = n.fit || 'fill'
  if (fit == 'contain' || fit == 'scale-down' || fit == 'none') {
    const k = fit == 'none' ? 1 : Math.min(dw / sw, dh / sh, fit == 'scale-down' ? 1 : Infinity)
    // what overflows the box (`none` of a big image) is cut from the source, centred
    const w = sw * k, h = sh * k
    if (w > dw) { sx += (sw - dw / k) / 2; sw = dw / k } else { dx += (dw - w) / 2; dw = w }
    if (h > dh) { sy += (sh - dh / k) / 2; sh = dh / k } else { dy += (dh - h) / 2; dh = h }
  } else if (fit == 'cover') {
    const k = Math.max(dw / sw, dh / sh), vw = dw / k, vh = dh / k
    sx += (sw - vw) / 2; sy += (sh - vh) / 2; sw = vw; sh = vh
  }
  return dw > 0 && dh > 0 ? {sx, sy, sw, sh, dx, dy, dw, dh} : null
}

// ---------------------------------------------------------------- sprite sheets

/** a sprite sheet: frames of one size in rows of `columns`, `margin` around them and `spacing` between (Phaser's spritesheet) */
export type Sheet = {src: string, frameWidth: number, frameHeight: number, columns: number, margin?: number, spacing?: number, crossOrigin?: string}

/** frame `index` of `sheet` as an image node's fields: `{ src, sx, sy, sw, sh }` (spread into the node) */
export function frameOf(sheet: Sheet, index: number) {
  const m = sheet.margin || 0, g = sheet.spacing || 0, i = Math.max(0, Math.floor(index))
  const c = i % sheet.columns, r = Math.floor(i / sheet.columns)
  const f: any = {src: sheet.src, sx: m + c * (sheet.frameWidth + g), sy: m + r * (sheet.frameHeight + g), sw: sheet.frameWidth, sh: sheet.frameHeight}
  if (sheet.crossOrigin != null) f.crossOrigin = sheet.crossOrigin
  return f
}

/**
 * the frame an animation shows at `t` (steps, or ms with `every` in ms): `frames` in turn, each for
 * `every`; `loop: false` holds the last one. Pure, so a replay shows the same frame
 */
export function frameAt(frames: readonly number[], t: number, every = 1, loop = true): number {
  const i = Math.floor(Math.max(0, t) / every)
  return frames[loop ? i % frames.length : Math.min(i, frames.length - 1)]
}

// ---------------------------------------------------------------- <Image>

const SEL = 'sygnal-asset'
/** the placeholder's owner renders again when the load settles (the same contract as sygnal/three's assets) */
const wait = (n: any, owner: any) => {
  const a = n.data.a
  if (a.s == 0) a.owners.add(owner)
  else queueMicrotask(() => owner.refresh())
  return n
}

/**
 * `<Image src x y width height …>` inside `<Canvas>`: an image node whose load `<Suspense>` waits
 * for; a failed load throws in the view (`onError`). Every other prop is the node's
 */
export const Image: any = () => { throw new Error('<Image> is a JSX tag inside <Canvas>') }
Image.__sygnalControl = (data: any, _children: any[], ce: any) => {
  const {children: _, ...rest} = data || {}
  const a = imageAsset(rest.src, rest.crossOrigin ?? null)
  if (a.s == 2) throw a.error
  if (a.s == 0) {
    pres[SEL] ||= wait
    return {sel: SEL, data: {attrs: {'data-sygnal-lazy': 'loading', 'data-src': rest.src}, a}, children: [], text: undefined, elm: undefined, key: rest.key}
  }
  return ce('image', rest)
}
Image.preload = preloadImage
Image.clear = clearImages
Object.defineProperty(Image, 'name', {value: 'Image'})
