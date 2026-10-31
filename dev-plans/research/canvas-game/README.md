# A real-time game on `sygnal/canvas`: a platformer, and what games need from Sygnal

Research spike, branch `claude/platformer-spike-3612c1` (on `claude/advanced-integration` at
`827ca5fd`). Nothing here touches `src/`: the game is `examples/platformer` ("Sprout Run"), the
plain-JS baseline is `baseline/`, the measurements are `perf/`. Decisions stay with the maintainer
(§6 lists the questions).

```bash
npm --prefix examples/platformer run dev          # the game (Enter, ←/→, Space, Shift, P)
npm --prefix examples/platformer test             # 29 tests: the sim alone, the component, replay
npm --prefix examples/platformer run build
node examples/platformer/node_modules/vite/bin/vite.js build --config dev-plans/research/canvas-game/baseline/vite.config.js
node dev-plans/research/canvas-game/perf/run.mjs --runs=3            # §3: both apps, 5 scenarios
node dev-plans/research/canvas-game/perf/run.mjs --only=sygnal --query=paint=lazy --label=lazy   # B2 measured
node dev-plans/research/canvas-game/perf/run.mjs --url=http://localhost:5173/ --label=dev     # the dev server (diagnostics + DevTools)
node dev-plans/research/canvas-game/perf/trace.mjs                   # §3: where "(program)" goes
```

URL switches: `?stress=N` (a one-screen arena with N moving enemies, already running),
`?bench` (window.__bench), `?paint=lazy` (without the B2 workaround).

## Summary

- **A real-time game works on Sygnal with the simulation in state**, and Sygnal's own cost per frame
  is small and flat: **≈ 0.1 ms** (one FRAME action, the reducer, the flush, the render, the patch,
  the island's sync), the same at 10 and at 2,000 moving entities. The level runs at ≈ 1 ms a frame
  (60 fps, no dropped frames; 4.5 ms throttled ×4). Against a hand-written rAF loop running the same
  simulation: 1.04 against 0.40 ms on the level, 1.24–1.30× from 300 to 2,000 entities, the
  difference being `sygnal/canvas`'s painting strategy, not the core (§3).
- **One bug makes every such game look slow: B2.** With a `frame` timer the canvas paints every
  other frame (30 fps while the world steps at 60), because its paint is a `requestAnimationFrame`
  asked from inside the timer's. Nothing reports it. Workaround: 12 lines in `main.tsx`. Fix: R1.
- **The canvas was tuned for editors, and it shows in a game**: an "everything moves" layer needs
  an id array and a `Set` per frame (F5); `active` reorders painting, so no parallax background or
  foreground (F6); the accessibility projection runs per frame unless each layer opts out (F7);
  above 1,000 live nodes the translation-blit heuristic costs 4 ms a frame for nodes that never
  translate (B4: 32 against the baseline's 43 fps at CPU ×4); a constantly scrolling camera
  makes the camera cache a full-canvas copy every frame. Each is small to fix (R3–R5).
- **Input is hand-made**: held keys, edges, repeat, prevented defaults and release-on-blur are
  ≈ 50 lines and there is no window-blur source (F4). Sampling input with the frame (R2) removes
  them and makes each frame one action and one recorded input.
- **Testing, replay and DevTools hold up with caveats**: fake timers make the game deterministic
  in `renderComponent` (the same run ends at the same pixel), but `settle()` can't settle with a
  frame loop and `simulateAction` can't be awaited (F2, F3). `sygnal/replay` replays a run with no
  divergence, but records 1.6 KB a frame (F12) and crashes on a number next to text in a view (B1).
  DevTools in dev keeps 5,000 full states: +2–3 MB/s with 300 enemies (F13).
- **Bugs found** (failing tests in the scratchpad, §5): B1 replay `mask` on a number, B2 paint
  every other frame, B3 SYG262 on an all-active layer, B4 the translation-blit cliff.

---

## The game

An original run-and-jump platformer: a red-capped sprout runs through a nine-screen meadow
(212 × 15 tiles of 32 px, six sections, a checkpoint halfway, a flag at the end).

- **Player**: acceleration, friction and skidding; sprint (Shift); variable-height jump (lower
  gravity while the button is held and the sprout rises), coyote time and a buffered press (a press
  and release inside one frame still jumps); gravity with a terminal speed.
- **Tiles**: ground, stone, bricks that break when bumped from below (debris), bonus blocks that pay
  a coin and are used up, ledges you jump through from below and land on, pits.
- **Enemies**: a walker (patrols, turns at walls and ledges), a hopper (waits, then jumps toward
  the player), a flyer (bobs back and forth, no gravity). Stomp to defeat (chained stomps score
  more), bumping a block under a walker or hopper flips it, touching one from the side hurts.
- **Rules**: coins and score, 3 lives (100 coins: one more), death and respawn at the start or the
  checkpoint, a 300 s clock, the goal (time left becomes points), a title screen, pause (P / Esc,
  and when the page is hidden), game over and course clear.
- **Camera**: a dead zone a little ahead of the way the player faces, clamped to the level.
- **View**: drawn shapes on four data layers (scenery, tiles, coins, actors); the HUD and the
  screens are HTML over the canvas.

| file | lines | |
|---|---:|---|
| `src/sim.ts` | 385 | the simulation: plain data in, plain data out, no Sygnal import |
| `src/level.ts` | 140 | levels as data, built from sections; the stress arena; `fromStrings` for tests |
| `src/nodes.ts` | 163 | the world as `sygnal/canvas` nodes, with identity kept for the cached layers |
| `src/Game.tsx` | 100 | the component: view, timers, browser static, intent, model |
| `src/keys.ts` | 9 | key codes → buttons (shared with the baseline) |
| `src/main.tsx` | 32 | `run()`, plus the B2 workaround |
| `src/bench.ts` | 28 | `window.__bench` for the perf runner |
| tests | 422 | `sim.test.ts` (20), `Game.test.tsx` (8), `replay.test.tsx` (1) |

`sygnal-check --strict` is clean; `test:examples` picks the example up by itself.

---

## 1. Friction log

Kept as I went, in the order it happened (F16 and F17 came out of the measurements). Each has what I wanted to write, what I wrote, and the
docs that misled or were missing. Severity: **high** (wrong behaviour or a trap with no
diagnostic), **medium** (a workaround or a lot of code), **low** (a papercut).

### F1 (high, bug B2): with a `frame` timer the canvas paints every other frame

The world steps 60 times a second; the canvas showed 30. Measured: 241 frames, 125 paints
(`?paint=lazy`, §3). Nothing reports it, and it looks like a slow game, not like a bug.

Why: the timer driver sends FRAME from inside its `requestAnimationFrame` callback. The flush
runs in that callback's microtasks, the Canvas's `sync` calls `invalidate()`, and `invalidate()`
asks for a `requestAnimationFrame`, which (asked from inside a frame's callbacks) is the *next*
frame. In that next frame the timer's FRAME invalidates again while that paint is still pending (no
new request), the paint runs, and the frame after that has no paint pending: the next request is
for the frame after. Paint, skip, paint, skip.

Wanted: nothing (the timer and the canvas are both Sygnal's). Wrote: `paintEveryFrame()` in
`main.tsx`, a rAF loop started after `run()` that calls `canvasOf(el).paintNow()` when the state
changed since the last paint (12 lines). It also paints in the frame the world stepped (no frame of
latency). Any widget that schedules its paint with `requestAnimationFrame` from `sync` would
interact with `frame` timers the same way: `sygnal/three`'s scene has the same `invalidate()`
(`src/three/scene.ts`), so a three.js game stepping through a `frame` timer likely renders at 30 fps
too (not measured).

### F2 (high): `t.settle()` never resolves while a frame timer runs

`await t.settle()` after a key press: "settle timed out after 2000ms: the component kept rendering".
With fake timers the waits drive the clock, every 16 ms of clock is a frame and a render, so the app
is never quiet. Wanted: `await t.settle()` (llms.txt §testing teaches it after every input).
Wrote: `await vi.advanceTimersByTimeAsync(0)` after each dispatched key event (runs the queued action
and its render, no frame). There's no `t.frames(n)` to step a frame loop.

### F3 (medium): `simulateAction` can't be placed between two frames

On the real DOM the harness holds an input until the tree has been quiet for a moment; with a frame
loop it is delivered at a time the harness picks, and it returns `void` (not the awaitable
`simulateEvent` has), so a test can't wait for it. Wanted: `await t.simulateAction('VISIBILITY',
{visible: false})`. Wrote: `t.simulateAction(...)` then `await vi.advanceTimersByTimeAsync(20)`.
For game input I dispatched real `KeyboardEvent`s on `document` instead, which go through the intent
at once and keep the frame they land in deterministic.

### F4 (medium): held keys are hand-made

`keymap` gives presses only. A game needs the held state of a few buttons, edges (a jump press that
is shorter than a frame must still jump), key repeat ignored, the page's own defaults (Space
scrolls) prevented for the game's keys only, and every key let go when the window loses focus.
Wanted (one of):

```jsx
Game.timers = (s) => ({ frame: running(s) && { frame: 'FRAME', keys: KEYS } })   // FRAME: { dt, held, pressed }
...held(DOM, { left: ['ArrowLeft', 'KeyA'], jump: ['Space', 'ArrowUp'] })      // a stream of the held set
```

Wrote: a code → button table, two intents (`keydown` with a `preventDefault` predicate, a repeat
filter, `keyup`), `keys` and `jumpQueued` in state, `press` / `release` / `releaseAll`, two reducers
that return `ABORT` for no change, and a `browser` static for `visibility` (≈ 50 lines, §2). There
is no window `blur` source (`DOM.select('window')` doesn't exist, and `blur` doesn't reach
`document`), so alt-tab with → held keeps running right until the page is hidden; `visibility`
covers switching tabs only. A held-keys source in the browser static would cover blur too.

### F5 (medium): an "everything moves" layer needs an id array every frame

The actors are a new array each frame, all of them moving. `active` takes ids, so the view builds
`idsOf(actors)` each frame; the Canvas turns each new array into a new `Set` (`setOf`, keyed by array
identity) and compares it with the last one (`sameActive`, a spread and a pass). With 300 enemies
`setOf` alone was the canvas's top function in the dev profile (98 ms over 20 s). Without `active`
the layer is static, so every frame repaints the static bitmap: tiles, scenery and coins too.
Wanted: `<shapes items={actors} live />`. The canvas guide describes `active` as "the ones being
dragged"; that a whole layer can be active, and that a layer that changes each frame must be, is
left for the reader to work out.

### F6 (medium): the live layer paints over every static layer, and screen nodes over everything

The live layer is its own canvas over the static one. So an active node of a lower layer paints
over static nodes of the layers above it, and `space="screen"` nodes paint over all of it. A
parallax background (positions change every frame, so it must be active) would cover the tiles;
there is no foreground (a bush in front of the player) either. Wanted:
`<shapes items={hills} parallax={0.5} />` under the tiles. Wrote: no parallax; the hills and clouds
are world-space scenery at factor 1 (cached). The docs don't say that `active` changes paint order.

### F7 (medium): the accessibility projection runs per frame unless each layer opts out

Every data layer projects up to 100 buttons into the DOM, and every `invalidate()` schedules the
projection (a microtask that walks the layer's items, an `aabb` per item, and moves DOM nodes): for
tiles, coins, scenery and actors that is DOM work 60 times a second, and a screen reader list of
"rect" buttons for a game that has none to offer. Wanted: off for the canvas (`<Canvas a11y={0}>`,
or off by default when `navigate={false}`). Wrote: `a11y={0}` on each of the four layers.

### F8 (low): the canvas takes Space

The canvas pans on Space-drag and grabs `keydown` Space on the document (`preventDefault`) unless
`navigate={false}`; the wheel pans the game's camera too. Wanted: a game passes `navigate={false}`
and knows why. Docs: the canvas guide mentions `navigate={false}` in one sentence under the camera.

### F9 (low): lines and paths are never culled and make a layer's bounds infinite

A brick's mortar as a `line` and the goal flag as a `path` made `contentOf` infinite for their
layer (the camera cache then works from the view only) and are painted wherever the camera is.
Wrote: rects. `paint.ts` documents it; the guide doesn't.

### F10 (low): no image or sprite node

The vocabulary is boxes, text and paths. A game wants `{ type: 'image', image, sx, sy, sw, sh }`
(a sprite sheet frame). Wrote: drawn shapes (the brief allowed it). A `path` node parses its `d`
into a `Path2D` once per node object (`n.$path`, written onto the node): a node rebuilt every frame
parses every frame.

### F11 (low, bug B1): a number child crashes the recorder

`<span>♥ ×{state.lives}</span>` with `startRecording()` on: `TypeError: s.replace is not a
function` in `replay/format.ts` `mask`, on every checkpoint, as an unhandled error (a lone
`{state.n}` is fine; a number next to text isn't). The view hash passes a vnode's `text` to `mask`
without `String()`, and a number among text children becomes a text vnode whose `text` is a
number. Wrote: template strings for the numbers in the HUD. Failing test:
`bugs.scratch.test.tsx` (scratchpad).

### F12 (medium): recordings are 1.6 KB a frame; replay hangs under fake timers

3.6 s of play: 231 inputs (216 FRAME), 232 checkpoints, 351 KB: 23 KB of actions, 316 KB of
checkpoints (each holds the state's changed paths and values: every enemy's `x` and `t` every
frame). That is ≈ 6 MB a minute. And `await replay(Game, log)` in a test that uses fake timers never
resolves (the test's 20 s timeout); `vi.useRealTimers()` first, then it replays in ≈ 1 s with no
divergence. Wanted: a checkpoint policy (`startRecording({ checkpoints: 'hash' })` or every Nth
for high-frequency inputs) and a replay that works on either clock.

### F13 (medium): the DevTools action log keeps every frame's whole world

In `vite dev`, DevTools records each action with its `before` and `after` state, up to 5,000
actions: 83 s of a 60 fps game. In the 300-enemy arena the heap grew ≈ 2–3 MB a second (17 → 74 MB
in 30 s) and keeps growing until the cap; frame time was unaffected (§3). A log of
5,000 FRAME rows isn't readable either. Wanted: high-frequency actions collapsed ("FRAME ×600")
and their states sampled.

### F14 (low): the docs teach a variable timestep

`guide/islands.md` and `llms/graphics.md`: `TICK: (state, { dt }) => step(state, dt / 1000)`. Physics
that integrates a variable `dt` jumps differently at 30, 60 and 144 Hz and tunnels through tiles on
a long frame. A game wants a fixed step with an accumulator (`advance()` in `sim.ts`, 8 lines). The
same pages say per-frame values don't belong in state; a game's simulation is the exception they
mention in one sentence, with no guidance on how to keep it cheap (one root component, cached
layers, `active`, `a11y={0}`).

### F15 (low): typing the model

`advance()` returns the world type; the component's state is the world plus the calculated
`camera`, so each reducer casts `as State`. The handler's 4th argument (`{ random }`) is `any`
unless typed by hand.

### F16 (high for big scenes, bug B4): the translation-blit cliff at 1,000 live nodes

Found in the stress runs, not while writing the game: the canvas paint goes 0.5 → 5.6 ms between
300 and 1,000 enemies. `backend.ts` tries a translation blit for ≥ 1,000 live nodes (`BLIT_MIN`, for
dragging a big selection); a game's nodes move independently, so `translation()` fails every
frame, and the fallback paints them into a 2× viewport bitmap whose `width` / `height` are set
(reallocating it) every frame, then copies it: `drawImage` is 4 ms of the frame. Nothing to do from
the app but keep each live layer under 1,000 nodes.

### F17 (low, bug B3): SYG262 on a layer that is all `active`

The rebuild check (`checkRebuild`) runs on every data layer, `active` or not. An actors layer of
≥ 64 nodes that stops moving for a moment (a death animation, hit-stop, a menu over a frozen game)
rebuilds its nodes with equal fields, and the dev build warns that "every frame repaints
everything", for nodes that are painted live every frame by design. Failing test in the
scratchpad.

### What worked without friction

- **The simulation as plain functions over plain data, called from one reducer.** `sim.ts` has no
  Sygnal import; 20 tests drive it step by step with no timers or DOM; the baseline runs it
  unchanged. Immutable updates per step cost little (§3: 0.02–0.6 ms a frame).
- **`frame` timers declared from state**: the loop runs only while the mode is a running one; pause,
  title and game over stop it with no code.
- **`random()` from the handler's props**: seeded in tests (`random: 1`), recorded by the replay.
- **Fake timers make the whole game deterministic** in `renderComponent`: a second of holding → ends
  at the same pixel every run (a test asserts it).
- **Record and replay** works at 60 actions a second: no divergence, `final` equals the recorded
  world.
- **The cached layers**: tiles, coins and scenery keep their node objects, and a camera pan is a
  bitmap copy (`shifted`), not a repaint.
- **`sygnal-check --strict`** is clean with no changes.

---

## 2. Boilerplate

What every game of this kind writes, how many lines it took here (non-blank, including the
plumbing in state and the reducers), and an API that would remove it. Costs are against D209 (no
dependency is needed for any of these) and the size gate (kanban gzip ≤ 43,000 B, 18 B of headroom
at PLAN-13): only items placed in the core touch it.

| pattern | lines here | where | proposal | lives in | cost |
|---|---:|---|---|---|---|
| Fixed timestep (accumulator, step cap, frame timer, FRAME reducer) | 12 | `sim.ts` `advance`, `Game.tsx` | `{ frame: 'STEP', step: 1000 / 60, max: 5 }`: the timer sends one action per fixed step (data `{ dt: step, n, alpha }`), or `{ frame, step }` sends `{ steps, dt }` once per frame | `makeTimerDriver` (driver, not core) | 0 B in the gate (kanban doesn't use timers); ~150 B in the timer driver |
| Held keys (codes → buttons, keydown/keyup intents, preventDefault, repeat, edges, release on hide) | ≈ 50 | `keys.ts`, `Game.tsx` intent + KEY_* reducers, `sim.ts` `press`/`release`/`releaseAll`/`jumpQueued` | input sampled with the frame: `{ frame: 'FRAME', keys: { left: ['ArrowLeft', 'KeyA'], … } }` → FRAME data `{ dt, held: { left: true }, pressed: ['jump'] }` (presses since the last frame, so a tap shorter than a frame counts); window blur releases all; the listed keys are default-prevented | the timer driver, or a `sygnal/game` subpath | 0 B in the gate; ~400 B in a driver |
| Entity update (per-kind step, despawn, activation) | 44 + 100 for the player | `sim.ts` `stepEnemy`, `step` | none: game-specific; a recipe shows the shape (`entities.map(step).filter(Boolean)`) | docs | – |
| AABB and tile collision (axis-separated moves, one-way ledges, head bumps, standing) | 60 | `sim.ts` `tileAt`…`standing`, `overlaps` | `moveAndCollide(body, grid, { solid, oneWay })` → `{ x, y, vx, vy, hitX, hitY, landed, head }`; `overlaps(a, b)` | a `sygnal/game` subpath (or a recipe) | 0 B in the gate; ~1 KB in the subpath |
| Camera follow (dead zone, look-ahead, clamp) | 9 | `sim.ts`, `Game.calculated`, `cameraOf` | `follow(camera, target, { deadZone, lead, bounds })` next to `fit` / `panBy` | `sygnal/canvas` kit | 0 B in the gate; ~150 B in canvas |
| Sprites and animation state (frame from a timer, facing, squash, flip) | ≈ 55 | `nodes.ts` `enemyNodes`, `playerNodes`, effects | an `image` node with a source rect, and `frameOf(anim, t)` for a strip; animation stays the app's (state already has `t`) | `sygnal/canvas` (node type + paint) | 0 B in the gate; ~300 B in canvas |
| Keeping node identity for the cached layers (memo per rows / coins / level, per-tile node cache) | 20 of `nodes.ts`'s 70 for tiles, coins, scenery | `tilesOf`, `coinsOf`, `sceneryOf` | `memoNodes(key, build)` or a `<shapes>` that diffs by `id` itself (equal fields → reuse the old object) | `sygnal/canvas` | 0 B in the gate; ~200 B in canvas |
| A live layer (id array each frame) | 2 + a Set per frame | `Game.tsx`, `nodes.ts` `idsOf` | `<shapes live>` | `sygnal/canvas` | ~20 B in canvas |
| Paint in the frame the world stepped (B2) | 12 | `main.tsx` | fixed in the library (§5, R1) | core + canvas | ≈ 60–120 B in the core if the fix is a frame phase |
| Tests stepping frames (`advanceTimersByTimeAsync`, no `settle`) | 4 + one per test | `Game.test.tsx` | `await t.frames(60)` (n frames of `dt` on the test clock), and `settle()` that ignores frame-timer renders | `renderComponent` | 0 B in the gate |

The proposals sort into three groups. **Input and the step** (fixed step, held keys) belong with
the timer driver, because the frame is where input is sampled: one FRAME action per frame carrying
the held buttons and the presses since the last frame is also what record/replay wants (one input
per frame instead of a FRAME plus key actions). **Canvas features** (live layers, parallax, paint
order, images, camera follow, identity memo) belong in `sygnal/canvas`, which already owns the
painting. **Game physics** (tile collision) is the only piece that is game-specific enough to argue
for recipes only; a `sygnal/game` subpath is worth it only if a second game example wants the same
functions.

---

## 3. Performance

**Method.** Production builds of both apps (`vite build`, the same `sim.ts`, `nodes.ts`'s actor
nodes and key table), Playwright Chromium 1243 headless (software raster, no GPU, dpr 1), an
800 × 520 viewport, a 768 × 480 canvas. Per scenario: 2 s warm-up, then 10 s measured, 3 runs
(medians below). Frame intervals from a rAF loop in the page; a frame is *dropped* when its
interval is over 25 ms. "Busy" is the main thread's non-idle time from a V8 CPU profile (100 µs
sampling) per frame, attributed through the source maps (`perf/run.mjs`); `(program)` is native
work outside JavaScript, which the trace (`perf/trace.mjs`) shows is mostly
`LayerTreeHost::DoUpdateLayers` (the canvases' draw commands rastered, in software here).
Scenarios: `level` (the meadow with an autopilot: → and sprint held, a jump every 0.9 s; it dies
in a pit now and then, like a player), `stressN` (the one-screen arena with N enemies, all in view,
all moving; ≈ 3 nodes each). The machine was **not quiet**: a VM outside this session used ≈ 3 cores
throughout (load average 5–7 on this 10-core Mac); the three runs agree within ±5 %. Raw results:
`perf/results/` (`both-3runs.json`, `both-cpu4.json`, `sygnal-paint-lazy.json`,
`sygnal-dev-server.json`, `perf-full.log` with the traces).

### Frame time and dropped frames

Sygnal with the B2 workaround (one paint per frame, as the baseline):

| scenario | Sygnal busy ms/frame | baseline | Sygnal / baseline | fps, dropped (both) | Sygnal canvas paint p50 | heap growth in 10 s (Sygnal / baseline) |
|---|---:|---:|---:|---|---:|---|
| level | 1.04 | 0.40 | 2.6× | 60, 0 | 0.1 ms | 3.3 / 0.1 MB |
| stress100 | 1.16 | 0.90 | 1.3× | 60, 0 | 0.2 ms | 2.5 / 1.2 MB |
| stress300 | 2.34 | 1.88 | 1.24× | 60, 0 | 0.5 ms | 0.3 / 0.4 MB |
| stress1000 | 6.83 | 5.26 | 1.30× | 60, 0 | **5.6 ms** | – |
| stress2000 | 12.67 | 9.99 | 1.27× | 60, 0 | 10.9 ms | – |

CPU throttled ×4 (a slower device):

| scenario | Sygnal busy | fps, dropped | baseline busy | fps, dropped |
|---|---:|---|---:|---|
| level | 4.49 | 59.8, 1 of 483 | 1.52 | 60, 0 |
| stress300 | 9.59 | 59.8, 1 of 485 | 8.12 | 60, 0 |
| stress1000 | 30.8 | **32.4**, 222 of 267 | 23.1 | **43.1**, 138 of 354 |

Without the workaround (`?paint=lazy`, the library as it is) the canvas paints every other frame
(B2: paints / frames = 0.50 in every scenario), so the busy time halves (level 0.70, stress300
1.40, stress1000 3.89 ms) and the game shows 30 fps.

The real level never comes near the budget: ≈ 1 ms of a 16.7 ms frame, 4.5 ms at CPU ×4. At a
few hundred moving entities Sygnal is within 25–30 % of the hand-written loop; both run at 60 fps
up to 2,000 entities unthrottled; throttled, both fall off between 300 and 1,000, Sygnal sooner.

### Where the time goes (ms per frame, medians, unthrottled)

| | level | stress300 | stress1000 | stress2000 |
|---|---:|---:|---:|---:|
| game: simulation (`sim.ts`) | 0.016 | 0.034 | 0.090 | 0.171 |
| game: actor nodes (`nodes.ts`) | 0.008 | 0.038 | 0.096 | 0.173 |
| **sygnal core** (queue, flush, render, patch, widget sync) | **0.105** | **0.097** | **0.098** | **0.106** |
| xstream + snabbdom | 0.016 | 0.015 | 0.013 | 0.014 |
| sygnal/canvas (JS: layer bookkeeping, painting calls) | 0.070 | 0.356 | 1.075 | 1.988 |
| native Canvas 2D / DOM calls | 0.087 | 0.292 | 4.855 | 9.489 |
| GC | 0.010 | 0.042 | 0.100 | 0.151 |
| (program): browser raster, compositing | 0.717 | 1.448 | 0.496 | 0.557 |
| **baseline** for comparison: its loop + painter JS / native / (program) | 0.039 / 0.036 / 0.299 | 0.12 / 0.27 / 1.43 | 0.31 / 0.79 / 3.97 | 0.60 / 1.50 / 7.56 |

What this says:

- **Sygnal's own cost is flat: ≈ 0.1 ms a frame** for the action, the reducer call, the flush, the
  render of the root, the patch (the HUD) and the island's sync, whether 10 or 2,000 enemies move. The
  simulation and the node building (the app's code, the same in both) are smaller still. Putting
  the simulation in state costs ≈ 0.1 ms a frame plus 0.01–0.1 ms of extra GC.
- **The rest of the difference is the canvas's painting strategy**, which was tuned for an editor
  (a static document, a few things moving, a camera at rest):
  - *level* (+0.6 ms): the camera scrolls every frame, so the static bitmap is copied to the
    canvas every frame (a camera-cache `shifted` frame) and two canvases are composited; the
    baseline just draws the ≈ 100 visible tiles. Cheap in absolute terms, but for a scrolling game
    the cache doesn't pay.
  - *stress300* (+0.5 ms): the canvas's JS per live node (`paintNode` through the vocabulary,
    `activeOf`, the `Set` of active ids per frame, F5) against the baseline's direct calls.
  - *stress1000 and up* (B4): at ≥ 1,000 live nodes the backend tries a translation blit
    (`BLIT_MIN`); nodes that move independently never translate, so each frame it repaints them
    into a bitmap twice the viewport in each dimension, resized (reallocated) every frame, and
    copies it back: `drawImage` alone is 4.0 ms a frame at 1,000 enemies (`both-3runs.json`, top
    functions). Paint p50 goes 0.5 → 5.6 ms between 300 and 1,000 enemies; that is what makes
    Sygnal drop to 32 fps throttled where the baseline holds 43.
- **GC** is 1–2 % of the busy time; the per-step immutable updates allocate (heap grows
  ≈ 0.3–0.6 MB/s between collections against ≈ 0.1 MB/s for the baseline) but minor GCs are cheap.

### The dev server (diagnostics + DevTools on)

`vite dev`, the same scenarios, 30 s: busy 1.03 ms (level) and 2.43 ms (stress300) a frame, about
the production build's; the dev tooling's own share is ≈ 0.05 ms. Memory is the problem: the
heap grew 17 → 74 MB in 30 s in the 300-enemy arena (DevTools keeps before/after states of the
last 5,000 actions, F13), and keeps growing until the cap at ≈ 83 s.

### Caveats

Headless Chromium rasters canvases in software, so `(program)` and the native canvas calls are
larger here than on a GPU; the JavaScript per frame, the blit cliff and B2 don't depend on that. A run on a quiet machine with a real GPU
(`headless: false`) would firm up the absolute numbers; I didn't open browser windows on the
maintainer's desktop.

---

## 4. Architecture

### Where should the simulation live?

**In state, as plain functions called from one reducer.** That is what the example does, and §3
says it is cheap: Sygnal's own JavaScript (action queue, flush, render, patch, widget sync) is
about 0.1 ms of a frame; the simulation 0.02–0.17 ms; what costs is painting, which the app would
pay with or without Sygnal. In return the whole game is testable step by step without a DOM
(`sim.test.ts`), deterministic under `renderComponent` with fake timers, replayable, pausable by
declaration (the timer is off outside the running modes), and the baseline runs the same `sim.ts`
unchanged.

The alternatives, and why not:

- **The canvas's own loop** (as `sygnal/three`'s `animate`, or `follow`): right for motion that
  is cosmetic and derived from time (a coin's spin, clouds drifting, parallax), wrong for the
  simulation: it isn't in state, so tests, replay, DevTools and pause can't see it, and collisions
  need the tiles and the other entities, which are state. `sygnal/canvas` has no `animate` for
  nodes yet; a game would use one for exactly the cosmetic part (proposal R6).
- **A store outside Sygnal** (a mutable world in a module, the component rendering a version
  counter): faster by the cost of immutable updates (≈ 0.01–0.1 ms a frame here), loses
  everything above. Not worth it at these sizes.
- **`sygnal/worker`**: the simulation is far below a frame; moving it off the main thread buys
  nothing until the painting moves too (OffscreenCanvas), which the worker target doesn't run yet.

The rule worth writing down: *the simulation is state; per-frame values that are only a function
of time are the canvas's.*

### How a per-frame tick fits the action queue and the flush

One FRAME action per animation frame, its reducer runs as many fixed steps as the frame owes (one
flush however many steps), the flush renders the one root component (the actors are rebuilt in the
view: the identity-keyed layers make that cheap for everything else), one patch, the island's
`sync`, the paint. Measured on the level: one action, one render, one patch and one paint per
frame with the B2 workaround.

Three things don't fit as well:

1. **The paint isn't part of the flush** (B2): it is a separate `requestAnimationFrame`, asked from
   inside one, so it lands a frame late and every other frame. The flush that a rAF callback
   causes should paint in that frame.
2. **Input arrives as its own actions between frames.** Each key press is an action, a flush and a
   render of the whole view (actors rebuilt, the canvas invalidated) between two frames, and the
   held state has to be carried in state for the next step. Sampling input with the frame (one
   FRAME with `held` / `pressed`) makes each frame one action and one render, and makes a
   recording one input per frame.
3. **The run-to-completion queue has no notion of "frame".** An `every`/`after` timer, a reply or
   a `next()` landing between two frames is fine for a game (each is a small action), but nothing
   says "after this frame's update, before its paint", which is where a game wants its effects
   (sound, haptics) and its paint.

### Testing (`renderComponent`, `now()` / `random()`)

Works, with fake timers driving the frame loop: a test holds → for 1,000 ms of clock, the world is
the same object every run (asserted by running it twice), and `random: 1` makes the brick debris
the same too. The FRAME data's `dt` comes from the timer (not `now()`), so no handler reads the
clock. The friction is in the harness's waits (F2, F3): `settle()` can't settle, `simulateAction`
can't be awaited and lands where the harness's quiet check puts it. `t.timers()` shows the frame
timer on and off with the mode, which is a nice assertion for pause.

### Record and replay at 60 actions a second

Works: a 3.6 s run (231 inputs, 216 of them FRAME) replays in ≈ 1 s to the same world (`final`
equals the recorded player and score; no divergence, nothing unhandled). Two problems: the size
(1.6 KB a frame, 90 % checkpoint diffs: ≈ 6 MB a minute, F12) and the number-child crash (B1),
plus `replay()` hanging under fake timers. With input sampled per frame (R2) a recording would be
one input per frame carrying the held buttons, which is also what a replay needs to be exact.

### The DevTools action log at 60 actions a second

Holds up for frame time (dev server: 2.43 ms a frame in the 300-enemy arena, against 2.34 ms in
the production build; the dev tooling's own share is ≈ 0.05 ms), not for memory: every action
keeps its before/after state, 5,000 of them (17 → 74 MB in 30 s here, F13). As a UI, 60 rows a second
are noise: collapse runs of one high-frequency action, keep the states of every Nth.

---

## 5. Recommendations

Ranked by what it costs a game author now against what the change costs. Effort: S (≤ a day), M
(a few days), L (a week or more).

| # | kind | recommendation | effort | priority |
|---|---|---|---|---|
| R1 | bug | **Paint in the frame the state changed (B2).** A widget invalidated during a `requestAnimationFrame` callback's flush should paint in that frame. Smallest fix, in `sygnal/canvas`: `invalidate()` notes whether a frame is being run (a module flag the timer driver and the canvas's own rAF set, or `performance.now()` against the last rAF timestamp) and paints at the end of the flush (`queueMicrotask`) instead of asking for the next frame. Cleaner: one frame scheduler in the core that runs frame timers, then flushes, then widget paints, in one rAF callback (≈ 60–120 B core; `sygnal/three` benefits too). A browser test: a frame timer moving one node, paints ≈ frames | S (canvas) / M (core) | **P0** |
| R2 | API | **Input sampled with the frame**: `{ frame: 'FRAME', keys: { left: ['ArrowLeft', 'KeyA'], … } }` → `{ t, dt, held, pressed, released }`; window blur releases; the listed keys default-prevented; a fixed `step` option (one action per frame with `steps`, or per step). Removes ≈ 60 lines from every game (held keys + accumulator), makes a frame one action and a recording one input per frame | M | **P1** |
| R3 | perf | **Translation blits only when the live nodes did translate.** At ≥ 1,000 live nodes the backend tries a translation blit; when the nodes move independently (every game) it paints them into a 2×2-viewport bitmap (resized, so reallocated, every frame) and copies it: paint 0.5 → 5.6 ms between 300 and 1,000 enemies, 32 against the baseline's 43 fps at CPU ×4 (§3, B4, F16). Keep the last frame's verdict (a layer that didn't translate last frame isn't tried this frame), and don't resize an unchanged blit bitmap | S | **P1** |
| R4 | API | **`<shapes live>`**: a layer whose nodes are all live (no ids, no Set per frame), and **paint order that survives `active`**: composite static runs and live layers in layer order (a static bitmap per run of static layers below / above a live one), so a live background under static tiles, and a foreground over the actors, work. With it, **`parallax={f}`** per layer (the layer's camera is `x * f`), cached like any static layer | M | P1 |
| R5 | API | **`<Canvas a11y={0}>`** for the whole canvas (and the projection only on idle, never per frame); a games section in the canvas guide: `navigate={false}`, `a11y={0}`, `live`, lines/paths and culling | S | P1 |
| R6 | testing | **`t.frames(n, { dt })`** in `renderComponent` (n frames of the frame timers on the test clock, resolving after the last render), **`settle()` that doesn't count frame-timer renders** as activity (or says what to use instead of timing out), **`simulateAction` returning the awaitable** `simulateEvent` returns, and **`replay()` under fake timers** | M | P1 |
| R7 | bug | **B1: `String()` the text in `vnodeString`** (`replay/format.ts`, both `text(v.text)` calls): a number child crashes every checkpoint while recording | S | P1 |
| R8 | dev tooling | **High-frequency actions in DevTools and recordings**: collapse runs of one action type in the log, keep `before`/`after` for every Nth (or the last N) of a type that fires more than ~10/s; `startRecording({ checkpoints: 'hash' })` (no per-checkpoint diffs) or a diff every Nth checkpoint. Today: ≈ 3 MB/s of retained states in dev with 300 enemies, 1.6 KB per frame in a recording | M | P2 |
| R9 | API | **An `image` node** (`{ type: 'image', image, sx, sy, sw, sh }`, an `ImageBitmap` / `HTMLImageElement` / URL through the `Texture`-style cache) and `frameOf(strip, t)`; `path` nodes cache their `Path2D` by `d` string, not on the node object | M | P2 |
| R10 | API | **`follow(camera, target, { deadZone, lead, bounds })`** in the canvas kit, next to `fit` / `panBy` | S | P2 |
| R11 | docs | **A games recipe** (canvas guide + `llms/graphics.md`): the simulation as plain functions in state; a fixed step with an accumulator instead of `step(state, dt / 1000)` (F14); held keys; static vs live layers; testing with fake timers; record/replay; what to keep out of state (cosmetic motion). Link `examples/platformer` | S | P2 |
| R12 | bug | **SYG262 on an all-active layer** (B3, F17): the rebuild check runs on layers whose nodes are all `active`, which repaint every frame by design; an actors layer that stops moving for a moment (a death animation) with ≥ 64 nodes would warn. Skip nodes in `active` | S | P3 |
| R13 | API | **`sygnal/game`** (tile collision `moveAndCollide`, `overlaps`, a fixed-step helper) only if a second game example wants the same functions; recipes until then | M | P3 |
| R14 | perf | **A scrolling camera without the full-canvas copy**: when the camera moves every frame and the static content in view is small (a game's ≈ 100 visible tiles), painting it beats copying the cached bitmap and compositing a second canvas (+0.4–0.6 ms a frame on the level, §3). A layer-level `cache={false}`, or a heuristic on the number of static nodes in view | S | P3 |

### The bugs, with their failing tests

The tests are in the session's scratchpad (`bugs.scratch.test.tsx`; a copy is in the coordinator's
shared notes folder as `canvas-game-bugs.test.tsx`); they run from `examples/platformer/src/`.

| | bug | test | fix |
|---|---|---|---|
| B1 | `sygnal/replay` crashes on every checkpoint when a view has a number next to text (`<span>n = {state.n}</span>`): `mask(s)` gets a number | records a counter with `<span>n = {n}</span>`; Vitest reports `TypeError: s.replace is not a function` as an unhandled error | `String()` the text in `vnodeString` / `markup` (`replay/format.ts`, two places) |
| B2 | with a `frame` timer, `<Canvas>` paints every other frame | not reproducible in jsdom (no painter); measured: `perf/run.mjs --query=paint=lazy`, paints / frames = 0.50 | R1 |
| B3 | SYG262 for a data layer whose nodes are all `active` | 100 frozen actors, all active, re-rendered 3 times: `expectNoDiagnostics()` fails with SYG262 | skip nodes in `active` in `checkRebuild` |
| B4 | ≥ 1,000 live nodes that don't translate: a 2×-viewport bitmap reallocated and repainted every frame | measured: `stress1000`, `drawImage` 4 ms a frame | R3 |
| (F2) | `t.settle()` times out with a frame timer running | a `{ frame }` timer component: `await t.settle()` → "settle timed out after 2000ms" | R6 |

---

## 6. Questions for the maintainer

1. **R1's shape**: fix B2 inside `sygnal/canvas` (paint at the end of a flush that ran inside a
   rAF callback), or add a frame phase to the core that frame timers and widgets share (update →
   flush → paint in one callback; `sygnal/three` and any future widget get it; ≈ 60–120 B of the
   18 B headroom left at PLAN-13)?
2. **Input with the frame (R2)**: is sampling held keys a job for the timer driver (one FRAME
   action carrying `held` / `pressed`), for the `browser` static (a `keys` source that sends the held
   set on change), or for a `sygnal/game` subpath? The first is the one that makes replay and
   determinism simplest; it also puts document key listeners in the timer driver.
3. **Is a game a target for `sygnal/canvas`?** The guide scopes it to editors, whiteboards and
   diagrams. R3–R5 and R9 (live layers, paint order, parallax, images, the blit heuristic) are
   small for the canvas but they make it a 2D game renderer too. Yes, or games on a separate
   painter (a `sygnal/canvas` backend, or recipes on a plain `<canvas>` island)?
4. **`sygnal/game`**: a subpath for tile collision and a fixed-step helper (R13), or recipes only?
   This spike recommends recipes until a second game wants the same code.
5. **High-frequency actions in DevTools and recordings (R8)**: collapse and sample by default
   (above a rate), or opt-in per action type (`devtools: { sample: { FRAME: 10 } }`)? Sampling
   loses the exact state of most frames in DevTools; a recording keeps every input regardless.
6. **The docs' rule "per-frame values don't belong in state"**: keep it as the default and add
   "except a game's simulation" with the recipe (R11), or soften it?
