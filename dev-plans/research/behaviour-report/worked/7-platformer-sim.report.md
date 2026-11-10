<!-- sygnal-behaviour-report -->
## Behaviour report

`ee35c135~1` (0c5af15f6c) → `ee35c135`. Components: 1 changed, 0 added, 0 removed. Derived from the code by `sygnal-check`, not from the author's description.

No side effect was added to an existing action, and no guard removed or write widened. That is all this line says: read the changes below.

### Also changed
- **Check** (Branch removed): `Game.STEP` STATE: logic that depended on `cx < left (in stepOnce)`, `cx > right (in stepOnce)` is gone (`examples/platformer/src/Game.tsx:68`)
- Note (Unclear): `Game.STEP` STATE changed in a way this report can't describe reliably: read the diff (`examples/platformer/src/Game.tsx:68`)

### `Game` · `examples/platformer/src/Game.tsx`

| | action | trigger | sinks | logic |
|---|---|---|---|---|
| ~ | `PAUSE` | unknown | STATE, writes: unknown | helper changed: code is the same, but `VIEW_W`, `cameraFor`, `clampCam`, `newWorld` changed _(low confidence)_ |
| ~ | `START` | unknown | STATE, writes: unknown | helper changed: code is the same, but `VIEW_W`, `cameraFor`, `clampCam`, `newWorld` changed _(low confidence)_ |
| ~ | `STEP` | reply | STATE, writes: unknown, reads -camX … | branches, conditions: fewer branches (66 → 65); condition gone: `cx < left (in stepOnce)`; condition gone: `cx > right (in stepOnce)`; new condition: `camera === w.camera (in track)`; also changed: `VIEW_H`, `cameraFor`, `clampCam`, `respawn`, `stepOnce`, `track` _(low confidence)_ |

- calculated `camera` removed
- view code changed (through `F.flat`, `F.flyer`, `F.hopper`, `F.jump`, `F.run`, `F.squashed`, `F.stand`, `F.walker`, `SHEET`, `actorsOf`, `enemyNodes`, `playerNodes`, `sprite`); reads -camX (markup, text and styling are not classified)

### What this report did not look at
- Changed code where no behaviour difference was found (comments, formatting, code no component reaches, or a limit of the analysis): `examples/platformer/src/env.d.ts`
- Changed files that aren't code: `examples/platformer/src/sprites.png`
- Changed tests: 1 file
- Components whose model or intent can't be listed whole: `Game`
- Not analysed at all: what the view renders (markup, text, styling), what happens inside helpers beyond whether they changed, runtime data and timing.
