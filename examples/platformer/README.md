# Sprout Run: a platformer on sygnal/canvas

A small side-scrolling platformer: run, sprint, variable-height jumps, bricks and bonus blocks,
ledges you jump through, pits, three enemy kinds (stomp them), coins, lives, a checkpoint, a goal,
pause and a title / game-over screen. Built for the canvas-game spike
(`dev-plans/research/canvas-game/README.md`), which records what was awkward and what it cost.

```bash
npm install
npm run dev      # Enter to start · ←/→ run · Space jump (hold for higher) · Shift sprint · P pause
npm test         # the simulation step by step, the component under fake timers, record/replay
```

- `src/sim.ts`: the simulation, plain functions over plain data (no Sygnal import), a fixed
  1/60 s step; `src/level.ts`: the level built from sections; `src/nodes.ts`: the world as
  `sygnal/canvas` nodes (cached layers keep their node objects; the actors are live).
- `src/Game.tsx`: one component. A `frame` timer runs while the game does; held keys are state.
- `src/main.tsx` paints the canvas in the frame the world stepped: a workaround for the canvas
  painting every other frame under a `frame` timer (the spike's B2).

URL switches: `?stress=300` (a one-screen arena with 300 moving enemies), `?bench`
(`window.__bench` for the perf runner), `?paint=lazy` (without the workaround).
