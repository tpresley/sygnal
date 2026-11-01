// sygnal/canvas 7.2 features: image nodes and <Image>, sprite sheets, follow(), wrapped text
import type { RootComponent } from 'sygnal'
import { Canvas, Image, follow, frameOf, frameAt, layoutText, measureText, preloadImage, clearImages } from 'sygnal/canvas'
import type { Camera, Node, Sheet, FollowOptions, TextLayout } from 'sygnal/canvas'

const SHEET: Sheet = { src: '/sprites.png', frameWidth: 16, frameHeight: 16, columns: 8 }
type S = { camera: Camera, x: number, tick: number, log: string[] }

export const Game: RootComponent<S, {}, { STEP: null; LOADED: { src: string } }> = ({ state }) => {
  const hero: Node = { id: 'hero', type: 'image', x: state.x, y: 0, width: 32, height: 32, ...frameOf(SHEET, frameAt([1, 2], state.tick, 8)), flipX: true, smoothing: false, alt: 'Hero' }
  const note: Node = { id: 'n', type: 'text', x: 0, y: 0, width: 120, text: 'wraps', wrap: 'word', maxLines: 2, ellipsis: true, align: 'center', lineHeight: 1.4 }
  const photo: Node = { id: 'p', type: 'image', src: '/photo.jpg', x: 0, y: 0, width: 100, height: 80, fit: 'cover', sx: 0, sy: 0, sw: 50, sh: 40 }
  return (
    <Canvas className="game" camera={state.camera} width={768} height={480}>
      <shapes className="actors" items={[hero, note, photo]} live />
      <Image src="/map.png" x={0} y={0} fit="contain" alt="Map" />
    </Canvas>
  )
}
Game.initialState = { camera: { x: 0, y: 0, zoom: 1 }, x: 0, tick: 0, log: [] }
Game.intent = ({ DOM }) => ({ STEP: DOM.click('.game').mapTo(null), LOADED: DOM.select('.game').events('imageload').map((e: any) => e.detail) })
const opts: FollowOptions = { width: 768, height: 480, deadzone: { width: 120, height: 480 }, offset: { x: -60 }, lerp: [0.2, 1], dt: 16, bounds: { x0: 0, y0: 0, x1: 6000, y1: 480 }, round: true }
Game.model = {
  STEP: (s) => ({ ...s, tick: s.tick + 1, camera: follow(s.camera, { x: s.x, y: 0, width: 22, height: 28 }, opts) }),
  LOADED: (s, d) => ({ ...s, log: [...s.log, d.src] }),
}

const l: TextLayout = layoutText('one two', { width: 40, fontSize: 10 })
const m: { width: number; height: number } = measureText('x', { fontSize: 12 })
const p: Promise<void> = preloadImage('/a.png', { crossOrigin: 'anonymous' })
const q: Promise<void> = Image.preload('/b.png')
clearImages()
const c: Camera = follow({ x: 0, y: 0, zoom: 1 }, { x: 1, y: 2 }, { width: 10, height: 10 })
void l; void m; void p; void q; void c
