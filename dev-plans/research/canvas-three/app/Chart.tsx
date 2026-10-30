/**
 * A bar chart on <Canvas2D>: the series are JSX children (one Bar component per point, with its
 * own intent), the tooltip is ordinary DOM.
 */
import {Collection} from 'sygnal'
import {Canvas2D} from '../lib/Canvas2D'

const W = 360, H = 200, PAD = 28

export function Bar({state, context}: any) {
  const bw = (W - PAD * 2) / context.count - 8, x = PAD + state.i * (bw + 8), bh = (state.value / context.max) * (H - PAD * 2)
  return (
    <g x={x} y={H - PAD}>
      <rect className="bar" role="button" attrs={{tabindex: 0}} aria-pressed={String(state.on)} aria-label={`${state.label}: ${state.value}`} x={0} y={-bh} width={bw} height={bh} rx={3} fill={state.on ? '#ffb547' : '#4f8cff'} />
      <text x={bw / 2} y={14} fontSize={10} fill="#9aa4b2" textAnchor="middle" pointerEvents="none">{state.label}</text>
    </g>
  )
}
Bar.intent = ({DOM}: any) => ({
  TOGGLE: DOM.click('.bar'),
  OVER: DOM.select('.bar').events('pointerover'),
  OUT: DOM.select('.bar').events('pointerout'),
})
Bar.model = {
  TOGGLE: (s: any) => ({...s, on: !s.on}),
  OVER: {PARENT: (s: any) => ({hover: s.label})},
  OUT: {PARENT: () => ({hover: null})},
}

export function Chart({state}: any) {
  const total = state.bars.filter((b: any) => b.on).reduce((n: number, b: any) => n + b.value, 0)
  return (
    <section className="chart-panel">
      <h2>Canvas 2D</h2>
      <Canvas2D className="chart" width={W} height={H} background="#10141c">
        {/* an <svg> root: the hidden children are rendered SVG, so focusable and accessible */}
        <svg aria-label="Sales by day">
          <line x1={PAD} y1={H - PAD} x2={W - PAD} y2={H - PAD} stroke="#3a4352" pointerEvents="none" />
          <Collection of={Bar} from="bars" />
        </svg>
      </Canvas2D>
      <p className="tip">{state.hover ? `${state.hover}` : 'hover a bar'} · selected total {total}</p>
    </section>
  )
}
Chart.initialState = {
  hover: null,
  bars: [['Mon', 12], ['Tue', 19], ['Wed', 7], ['Thu', 15], ['Fri', 22], ['Sat', 9]].map(([label, value], i) => ({id: i, i, label, value, on: false})),
}
Chart.context = {count: (s: any) => s.bars.length, max: (s: any) => Math.max(...s.bars.map((b: any) => b.value))}
Chart.intent = ({CHILD}: any) => ({HOVER: CHILD.select(Bar)})
Chart.model = {HOVER: (s: any, d: any) => ({...s, hover: d.hover})}
