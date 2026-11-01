// sygnal/canvas (7.2 dev preview; dev-plans/research/canvas-apps) with real input (window.__pwInput,
// __pw): a captured drag that leaves the canvas and comes back, wheel pan, ctrl-wheel zoom toward
// the cursor, a two-finger pinch (CDP touch: Chromium), text editing in a positioned textarea, the
// accessibility projection in the engine's tree, painting on a real 2D context; a game loop (canvas-game:
// one paint per frame under a frame timer, keys held through real input). BROWSER=chromium|firefox|webkit.
import { run, ABORT, makeTimerDriver } from 'sygnal'
import { Canvas, canvasOf, pointer, toScreen, toWorld } from 'sygnal/canvas'
import { mountOnScreen, clearStage, assert, runTest, wait, waitFor } from '../harness.js'

const CAT = 'sygnal/canvas (7.2)'
const ua = navigator.userAgent
const ENGINE = /Firefox\//.test(ua) ? 'firefox' : /Chrome\//.test(ua) ? 'chromium' : 'webkit'

function Editor({ state }) {
  const ed = state.editing && state.shapes.find((x) => x.id === state.editing)
  const p = ed && toScreen(state.camera, ed.x, ed.y)
  return (
    <div className="ed" style={{ position: 'relative', width: '400px', height: '300px' }}>
      <Canvas className="board" camera={state.camera} width={400} height={300} background="#f5f5f5">
        <shapes className="doc" items={state.shapes} active={state.drag ? [state.drag.id] : null} aria-label="Page" />
      </Canvas>
      {ed ? <textarea className="text-edit" aria-label="Text" value={ed.text} style={{ position: 'absolute', left: p.x + 'px', top: p.y + 'px', width: '160px', height: '30px' }} /> : null}
      <p className="out">{JSON.stringify({ a: state.shapes[0], t: state.shapes[1].text, camera: state.camera, clicks: state.clicks, drag: !!state.drag })}</p>
    </div>
  )
}
Editor.initialState = {
  shapes: [
    { id: 'a', type: 'rect', name: 'Card', x: 40, y: 40, width: 100, height: 80, fill: '#0d99ff' },
    { id: 't', type: 'text', name: 'Title', x: 200, y: 40, width: 120, height: 30, text: 'Hello', fontSize: 20, fill: '#000' },
  ],
  camera: { x: 0, y: 0, zoom: 1 }, drag: null, editing: null, clicks: 0,
}
Editor.intent = ({ DOM }) => {
  const b = DOM.select('.board')
  return {
    DOWN: b.events('pointerdown').map((e) => ({ ...pointer(e), world: e.world })),
    MOVE: b.events('pointermove').filter((e) => e.captured).map((e) => e.delta),
    UP: b.events('pointerup'),
    CLICK: b.events('click').filter((e) => e.hit),
    DBL: b.events('dblclick').map(pointer),
    CAMERA: b.events('camerachange').detail(),
    TEXT: DOM.input('.text-edit').value(),
    DONE: DOM.select('.text-edit').events('keydown').filter((e) => e.key == 'Escape'),
  }
}
const edit = (s, id, f) => ({ ...s, shapes: s.shapes.map((x) => x.id === id ? f(x) : x) })
Editor.model = {
  DOWN: (s, p) => p.hit == 'a' ? { ...s, drag: { id: 'a', start: s.shapes[0] } } : ABORT,
  MOVE: (s, d) => s.drag ? edit(s, 'a', () => ({ ...s.drag.start, x: s.drag.start.x + d.x, y: s.drag.start.y + d.y })) : ABORT,
  UP: (s) => s.drag ? { ...s, drag: null } : ABORT,
  CLICK: (s) => ({ ...s, clicks: s.clicks + 1 }),
  DBL: {
    STATE: (s, p) => p.hit == 't' ? { ...s, editing: 't' } : ABORT,
    ELEMENT: (s) => s.editing ? { focus: '.text-edit' } : ABORT,
  },
  CAMERA: (s, camera) => ({ ...s, camera }),
  TEXT: (s, text) => s.editing ? edit(s, s.editing, (x) => ({ ...x, text })) : ABORT,
  DONE: (s) => ({ ...s, editing: null }),
}

const input = (steps) => window.__pwInput(steps)

export async function canvasTests7_2() {
  if (typeof window.__pwInput !== 'function') {
    await runTest(CAT, 'real input (window.__pwInput from run-headless.mjs)', async () => {
      assert(false, 'window.__pwInput is missing: run the suite with npm --prefix browser-tests test')
    })
    return
  }
  const setup = async () => {
    const { id, el } = mountOnScreen()
    const app = run(Editor, {}, { mountPoint: id })
    await waitFor(() => el.querySelector('.board canvas.sygnal-canvas'), 4000)
    await wait(30)
    const c = canvasOf(el.querySelector('.board'))
    const r = () => c.canvas.getBoundingClientRect()
    // a world point on the page (client pixels)
    const at = (wx, wy) => { const p = toScreen(c.camera, wx, wy), b = r(); return [b.x + p.x, b.y + p.y] }
    const out = () => JSON.parse(el.querySelector('.out').textContent)
    return { id, el, app, c, r, at, out, done: () => { app.dispose(); clearStage() } }
  }

  await runTest(CAT, 'a real drag: the pressed shape keeps the pointer off the canvas and back (capture), through the action queue; no click', async () => {
    const { at, out, r, c, done } = await setup()
    try {
      const [x, y] = at(90, 80), b = r()
      await input([['move', x, y], ['down'], ['move', x + 20, y, 3], ['wait', 30]])
      await waitFor(() => out().drag)
      await input([['move', b.right + 60, y + 10, 8], ['wait', 30], ['move', b.right - 100, y + 30, 6], ['wait', 30], ['up'], ['wait', 60]])
      await waitFor(() => !out().drag)
      const o = out()
      assert(Math.abs(o.a.x - (40 + (b.right - 100 - x))) < 2 && Math.abs(o.a.y - 70) < 2, 'moved by the pointer: ' + JSON.stringify(o.a))
      assert(o.clicks === 0, 'a drag clicks nothing: ' + o.clicks)
      // painted on a real 2D context: the static layer once, then the live layer
      assert(!c.headless && c.st.paints > 0 && c.st.statics >= 1, 'painted: ' + JSON.stringify(c.st))
      // a press without a drag is a click on the shape
      const [x2, y2] = at(o.a.x + 10, o.a.y + 10)
      await input([['move', x2, y2], ['down'], ['up'], ['wait', 60]])
      await waitFor(() => out().clicks === 1)
    } finally { done() }
  }, 8000)

  await runTest(CAT, 'wheel pans; ctrl-wheel (a trackpad pinch) zooms toward the cursor; camerachange reaches state', async () => {
    const { at, out, r, c, done } = await setup()
    try {
      const b = r()
      await input([['move', b.x + 200, b.y + 150], ['wheel', 30, 20], ['wait', 80]])
      await waitFor(() => out().camera.x > 0)
      const cam = out().camera
      assert(Math.abs(cam.x - 30) < 1 && Math.abs(cam.y - 20) < 1 && cam.zoom === 1, 'panned: ' + JSON.stringify(cam))
      // the world point under the cursor before the zoom
      const sx = 100, sy = 120, w0 = toWorld(c.camera, sx, sy)
      await input([['move', b.x + sx, b.y + sy], ['keyDown', 'Control'], ['wheel', 0, -60], ['keyUp', 'Control'], ['wait', 80]])
      await waitFor(() => out().camera.zoom > 1.2)
      const w1 = toWorld(out().camera, sx, sy)
      assert(Math.abs(w1.x - w0.x) < 0.5 && Math.abs(w1.y - w0.y) < 0.5, `the point under the cursor stays: ${JSON.stringify(w0)} → ${JSON.stringify(w1)}`)
      // at rest after the gesture: repainted (the camera cache scaled the bitmap meanwhile)
      await wait(200)
      assert(!c.moving(), 'the camera at rest')
      void at
    } finally { done() }
  }, 8000)

  if (ENGINE === 'chromium') {
    await runTest(CAT, 'two-finger pinch (CDP touch) zooms and pans; the first finger\'s press is cancelled', async () => {
      const { out, r, done } = await setup()
      try {
        const b = r(), cx = b.x + 200, cy = b.y + 150
        // one finger down, then the second (a touchStart with both), then they spread
        const steps = [['touches', 'touchStart', [[cx - 40, cy]]], ['wait', 20], ['touches', 'touchStart', [[cx - 40, cy], [cx + 40, cy]]]]
        for (let i = 1; i <= 6; i++) steps.push(['touches', 'touchMove', [[cx - 40 - i * 10, cy], [cx + 40 + i * 10, cy]]])
        steps.push(['touches', 'touchEnd', []], ['wait', 80])
        await input(steps)
        await waitFor(() => out().camera.zoom > 1.5, 2000).catch(() => { throw new Error('no pinch zoom: ' + JSON.stringify(out().camera)) })
        assert(!out().drag, 'no drag left over')
      } finally { done() }
    }, 8000)
  }

  await runTest(CAT, 'text editing: a double-click opens the textarea (focused by ELEMENT, not stolen by the press); typing edits the node', async () => {
    const { id, at, out, el, done } = await setup()
    try {
      const [x, y] = at(230, 55), b = el.querySelector('.board canvas.sygnal-canvas').getBoundingClientRect()
      await window.__pw('dblclick', `${id} .board canvas.sygnal-canvas`, { position: { x: x - b.x, y: y - b.y } })
      await waitFor(() => el.querySelector('.text-edit'), 2000)
      await waitFor(() => document.activeElement === el.querySelector('.text-edit'), 2000).catch(() => { throw new Error('focus: ' + document.activeElement?.outerHTML?.slice(0, 80)) })
      await window.__pw('press', `${id} .text-edit`, 'End')
      await window.__pw('type', `${id} .text-edit`, ', canvas')
      await waitFor(() => out().t === 'Hello, canvas')
      await input([['key', 'Escape'], ['wait', 50]])
      await waitFor(() => !el.querySelector('.text-edit'))
    } finally { done() }
  }, 8000)

  await runTest(CAT, 'the accessibility projection: the shapes are buttons in the engine\'s tree; Enter on one presses it', async () => {
    const { id, out, el, done } = await setup()
    try {
      await waitFor(() => el.querySelectorAll('.doc [role="button"]').length === 2)
      const n = await window.__pw('role', `${id}`, { role: 'button', name: 'Card', includeHidden: false })
      assert(n === 1, 'getByRole(button, Card): ' + n)
      if (ENGINE === 'chromium') {
        const ax = await window.__pw('ax', `${id}`, { role: 'button', name: 'Card', in: 'group' })
        assert(ax === 'exposed', 'Chromium AX tree: ' + ax)
      }
      await window.__pw('focus', `${id} .doc [aria-label="Card"]`)
      await input([['key', 'Enter'], ['wait', 60]])
      await waitFor(() => out().clicks === 1)
    } finally { done() }
  }, 8000)

  await runTest(CAT, 'a game loop: a frame timer steps the world, the canvas paints every frame (not every other), real held keys move the player', async () => {
    const { id, el } = mountOnScreen()
    function Runner({ state }) {
      return (
        <Canvas className="game" width={300} height={120} navigate={false} a11y={0}>
          <shapes className="ground" items={[{ id: 'g', type: 'rect', x: 0, y: 100, width: 2000, height: 20, fill: '#a0612e' }]} />
          <shapes className="actors" items={[{ id: 'p', type: 'rect', x: state.x, y: 80, width: 20, height: 20, fill: '#e8603c' }]} live />
        </Canvas>
      )
    }
    Runner.initialState = { x: 0, steps: 0 }
    // (no `step`: an action every frame, whatever the engine's frame rate; Firefox headless runs at 120 Hz)
    Runner.timers = () => ({ loop: { frame: 'STEP', keys: { right: 'ArrowRight' } } })
    Runner.model = { STEP: (s, { held }) => ({ ...s, steps: s.steps + 1, x: s.x + (held.right ? 2 : 0) }) }
    const app = run(Runner, { TIMER: makeTimerDriver() }, { mountPoint: id })
    try {
      await waitFor(() => el.querySelector('.game canvas.sygnal-canvas'), 4000)
      const c = canvasOf(el.querySelector('.game'))
      await wait(100)
      // count the page's frames and the canvas's paints over ~40 frames
      let frames = 0, on = true
      const loop = () => { if (!on) return; frames++; requestAnimationFrame(loop) }
      const p0 = c.st.paints
      requestAnimationFrame(loop)
      await wait(700)
      on = false
      const paints = c.st.paints - p0
      assert(frames > 10 && paints >= frames * 0.85, `one paint per frame: ${paints} paints in ${frames} frames`)
      const x0 = app.__runtime.getState().x
      await input([['keyDown', 'ArrowRight'], ['wait', 300], ['keyUp', 'ArrowRight'], ['wait', 50]])
      const x1 = app.__runtime.getState().x
      assert(x1 - x0 > 20, 'held → moved the player: ' + (x1 - x0))
    } finally { app.dispose(); clearStage() }
  }, 8000)

  await runTest(CAT, 'a canvas sized by CSS shows its content at once: the first ResizeObserver report (the same size) does not clear it', async () => {
    const { id, el } = mountOnScreen()
    function Sized() {
      return (
        <Canvas className="sized" background="#fafafa" style={{ width: '300px', height: '150px' }}>
          <shapes className="doc" items={[{ id: 'a', type: 'rect', x: 20, y: 20, width: 100, height: 60, fill: '#0d99ff' }]} />
        </Canvas>
      )
    }
    const app = run(Sized, {}, { mountPoint: id })
    try {
      await waitFor(() => el.querySelector('.sized canvas.sygnal-canvas'), 4000)
      const c = canvasOf(el.querySelector('.sized'))
      // past the ResizeObserver's first report and its paint
      await wait(150)
      const px = (x, y) => [...c.canvas.getContext('2d').getImageData(Math.round(x * c.canvas.width / 300), Math.round(y * c.canvas.width / 300), 1, 1).data]
      const bg = px(250, 120), shape = px(60, 50)
      assert(bg[0] > 240 && bg[1] > 240 && bg[2] > 240, 'the background, not a cleared (black) canvas: ' + bg)
      assert(shape[0] < 40 && shape[2] > 200, 'the shape: ' + shape)
    } finally { app.dispose(); clearStage() }
  }, 8000)
}
