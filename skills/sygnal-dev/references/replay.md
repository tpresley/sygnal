# Sygnal: Record and replay (`sygnal/replay`, dev preview)

> A topic file of Sygnal's agent context. It assumes the core (`llms.txt`, or the sygnal-dev skill's `SKILL.md`: mental model, component anatomy, canonical forms, wiring rules, testing): read that first. Canonical forms only.

- Record and replay (dev preview, `sygnal/replay`): `const rec = startRecording()` before `run(App)` records the session's input actions (redaction of typed text and server data on by default; `{ redact: { keep: ['SET_FILTER'] } }` / `false`); `rec.stop()` gives JSON. In a test, `const r = await replay(App, log)` (also from `'sygnal'`) replays it in renderComponent: `r.divergence` (first action whose state differs, with `diff`), `r.view` (view-only change), `r.effects`, `r.unhandled`, `r.warnings`, `r.final`, `r.t.dispose()`. `replayTest(log)` writes the test file, `bugReport(log, r)` Markdown; DevTools' Copy as test has `{ mode: 'replay' }`. Guide: https://sygnal.js.org/guide/record-replay/
