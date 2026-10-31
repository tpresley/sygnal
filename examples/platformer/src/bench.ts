/**
 * window.__bench (with ?bench): what dev-plans/research/canvas-game/perf/run.mjs reads. The same
 * fields as the plain-JS baseline's (baseline/main.ts), so one runner measures both.
 * - frames: every requestAnimationFrame interval (ms) since reset()
 * - sim: the time inside advance() (the simulation steps) and the steps run
 * - paint: the canvas's own paint time per paint (sygnal/canvas `st.ms`) and the paints made
 */
import {canvasOf} from 'sygnal/canvas'
import {perf} from './sim'

export function installBench(app: any) {
  let frames: number[] = [], paints: number[] = [], last = 0, seen = 0, inst: any = null
  perf.on = true
  const loop = (t: number) => {
    if (last) frames.push(t - last)
    last = t
    inst ||= canvasOf(document.querySelector('.game'))
    // the canvas paints in its own frame callback: read its last paint time once per new paint
    if (inst && inst.st.paints != seen) { seen = inst.st.paints; paints.push(inst.st.ms) }
    requestAnimationFrame(loop)
  }
  requestAnimationFrame(loop)
  ;(window as any).__bench = {
    app,
    reset() { frames = []; paints = []; last = 0; perf.ms = 0; perf.steps = 0 },
    read: () => ({frames, paints, simMs: perf.ms, steps: perf.steps, state: app.__runtime?.getState?.()?.mode}),
  }
}
