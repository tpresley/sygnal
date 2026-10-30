/**
 * A frame source: `FRAME.frames()` is a stream of { t, dt } (seconds), one per animation frame,
 * running only while an intent listens to it.
 *
 *   run(App, { FRAME: makeFrameDriver() })
 *   App.intent = ({ FRAME }) => ({ TICK: FRAME.frames() })
 *
 * This is the path for per-frame values that must be state (a game's simulation step, a timer
 * the HUD shows). Every frame is then an action, a flush and a patch (test/frame.test.tsx counts
 * them). Values that only move the picture belong in `animate` props (lib/three.ts), which cost
 * no app work per frame. A source with `every: n` samples (every n-th frame) for HUD-rate state.
 */
import {xs} from 'sygnal'

export function makeFrameDriver({raf, caf}: {raf?: (f: (ms: number) => void) => any, caf?: (id: any) => void} = {}) {
  const g: any = globalThis
  const request = raf || ((f: any) => g.requestAnimationFrame(f)), cancel = caf || ((id: any) => g.cancelAnimationFrame(id))
  return function frameDriver() {
    return {
      frames({every = 1}: {every?: number} = {}) {
        let id: any, last = -1, n = 0
        return xs.create({
          start(l: any) {
            const loop = (ms: number) => {
              id = request(loop)
              const t = ms / 1000, dt = last < 0 ? 0 : t - last
              if (n++ % every == 0) { l.next({t, dt: last < 0 ? 0 : dt}); last = t }
            }
            id = request(loop)
          },
          stop() { cancel(id); last = -1; n = 0 },
        })
      },
    }
  }
}

/** a manual frame clock for tests and benchmarks: step(n) runs n frames of 1/60 s */
export function fakeFrames() {
  let q = new Map<number, (ms: number) => void>(), id = 0, now = 0
  return {
    raf: (f: (ms: number) => void) => (q.set(++id, f), id),
    caf: (i: number) => { q.delete(i) },
    step(n = 1) {
      for (let i = 0; i < n; i++) {
        now += 1000 / 60
        const due = q; q = new Map()
        for (const f of due.values()) f(now)
      }
    },
    now: () => now,
  }
}
