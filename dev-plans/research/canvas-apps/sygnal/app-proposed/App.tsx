/**
 * Figma-lite on the proposed sygnal/canvas (README §6): app/App.tsx with the kit's keymap and
 * handles, without the research toggles. (lib/canvas stands in for the 'sygnal/canvas' import.)
 */
import {ABORT, VirtualCollection} from 'sygnal'
import {Canvas, pointer, toScreen, keymap, merge, handles} from '../lib/canvas'
import {LayerRow} from '../app/LayerRow'
import {byId} from '../app/doc'
import * as M from './model'
import type {State} from './model'

const TOOLS: [M.Tool, string, string][] = [['select', 'V', 'Move'], ['frame', 'F', 'Frame'], ['rect', 'R', 'Rectangle'], ['ellipse', 'O', 'Ellipse'], ['text', 'T', 'Text']]
const BLUE = '#0d99ff'

/** the selection outline, handles, hover outline, snap guides, marquee: screen-space JSX nodes */
function overlay(s: State) {
  const cam = s.camera, z = cam.zoom, out: any[] = []
  const screenBox = (b: any) => { const p = toScreen(cam, b.x, b.y); return {x: p.x, y: p.y, width: b.width * z, height: b.height * z, rotation: b.rotation || 0} }
  const hov = !s.gesture && s.hover && !s.selection.includes(s.hover) && byId(s.shapes, s.hover)
  if (hov) out.push(<rect className="hover-outline" space="screen" {...screenBox(hov)} fill="none" stroke={BLUE} strokeWidth={1.5} pointerEvents="none" />)
  for (const g of s.guides) {
    const a = toScreen(cam, g.x1, g.y1), b = toScreen(cam, g.x2, g.y2)
    out.push(<line className="guide" space="screen" x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#f24822" strokeWidth={1} pointerEvents="none" />)
  }
  if (s.gesture?.kind == 'marquee' && s.gesture.moved) {
    const g = s.gesture, a = toScreen(cam, Math.min(g.from.x, g.at.x), Math.min(g.from.y, g.at.y))
    out.push(<rect className="marquee" space="screen" x={a.x} y={a.y} width={Math.abs(g.at.x - g.from.x) * z} height={Math.abs(g.at.y - g.from.y) * z} fill="rgba(13,153,255,0.08)" stroke={BLUE} strokeWidth={1} pointerEvents="none" />)
  }
  const box = M.selectionBox(s)
  if (box && !s.editing) {
    // each selected shape's own outline when several are selected
    out.push(...handles(box, cam, {grips: !(s.gesture?.kind == 'move' && s.gesture.moved)}))
  }
  return out
}

const num = (v: number) => Math.round(v * 100) / 100
function field(label: string, key: string, vals: any[], type = 'number', fmt = (v: any) => v) {
  const same = vals.length && vals.every(v => v === vals[0])
  return (
    <label className="field">
      <span>{label}</span>
      <input className="prop" type={type} data={{key}} value={same ? String(fmt(vals[0])) : ''} placeholder={vals.length ? 'Mixed' : ''} />
    </label>
  )
}

// a plain function, not a <PropsPanel> tag: a capitalized tag is a component, isolated from App's intent
function propsPanel(s: State) {
  const sel = s.selection.map(id => byId(s.shapes, id)!).filter(Boolean)
  if (!sel.length) return <aside className="props"><h2>Design</h2><p className="hint">Select a layer to edit its properties.</p></aside>
  const v = (k: string) => sel.map((x: any) => x[k])
  return (
    <aside className="props" aria-label="Properties">
      <h2>{sel.length == 1 ? sel[0].name : `${sel.length} layers`}</h2>
      <div className="grid">
        {field('X', 'x', v('x'), 'number', num)}{field('Y', 'y', v('y'), 'number', num)}
        {field('W', 'width', v('width'), 'number', num)}{field('H', 'height', v('height'), 'number', num)}
        {field('°', 'rotation', v('rotation'), 'number', num)}{field('◜', 'radius', v('radius'), 'number', num)}
      </div>
      <h3>Fill</h3>
      <div className="grid">{field('', 'fill', v('fill'), 'color')}{field('', 'fill', v('fill'), 'text')}</div>
      <h3>Stroke</h3>
      <div className="grid">{field('', 'stroke', v('stroke').map(c => c == 'none' ? '#000000' : c), 'color')}{field('W', 'strokeWidth', v('strokeWidth'), 'number', num)}</div>
      <h3>Layer</h3>
      <div className="grid">{field('%', 'opacity', v('opacity'), 'number', (o: number) => Math.round(o * 100))}
        {sel.every(x => x.type == 'text') ? field('Aa', 'fontSize', v('fontSize'), 'number', num) : null}</div>
      <h3>Export</h3>
      <div className="row"><button className="export" data={{which: 'selection'}}>Export selection as SVG</button></div>
    </aside>
  )
}

export function App({state: s}: {state: State & {rows: M.Row[]}}) {
  const g = s.gesture
  const editing = s.editing && byId(s.shapes, s.editing)
  const active = g && g.moved && g.kind != 'marquee' ? (g.ids || (g.id ? [g.id] : null)) : null
  let editor: any = null
  if (editing) {
    const p = toScreen(s.camera, editing.x, editing.y), z = s.camera.zoom
    editor = <textarea className="text-edit" aria-label="Text" value={editing.text}
      style={{left: p.x + 'px', top: p.y + 'px', fontSize: (editing.fontSize || 16) * z + 'px', width: Math.max(40, (editing.width + 20) * z) + 'px', height: editing.height * z + 'px', transform: `rotate(${editing.rotation}deg)`, color: editing.fill}} />
  }
  return (
    <div className="app">
      <header className="toolbar" role="toolbar" aria-label="Tools">
        {TOOLS.map(([t, key, label]) => <button className={'tool' + (s.tool == t ? ' on' : '')} data={{tool: t}} aria-pressed={String(s.tool == t)} title={`${label} (${key})`}>{label}</button>)}
        <span className="sep" />
        <button className="undo" disabled={!s.past.length}>Undo</button>
        <button className="redo" disabled={!s.future.length}>Redo</button>
        <span className="sep" />
        <button className="zoom-out" aria-label="Zoom out">−</button>
        <button className="zoom-reset zoom-readout" title="Zoom to 100%">{Math.round(s.camera.zoom * 100)}%</button>
        <button className="zoom-in" aria-label="Zoom in">+</button>
        <button className="zoom-fit">Fit</button>
        <span className="sep" />
        <button className="export" data={{which: 'page'}}>Export page</button>
        <span className="sep" />
        <span className="lab">Stress</span>
        {[1000, 5000, 10000].map(n => <button className="stress" data={{n}}>{n / 1000}k</button>)}
        <span className="count">{s.shapes.length} layers</span>
      </header>
      <aside className="layers-panel" aria-label="Layers">
        <h2>Layers</h2>
        <VirtualCollection of={LayerRow} from="rows" className="layers" estimateSize={26} aria-label="Layers" />
      </aside>
      <main className={'stage tool-' + s.tool}>
        <Canvas className="board" camera={s.camera} grid>
          <shapes className="doc" items={s.shapes} active={active} />
          {/* each selected shape's own outline when several are selected: an outline layer (data, never hit) */}
          {s.selection.length > 1 && !s.editing && <shapes className="sel-outlines" items={s.selection.map(id => byId(s.shapes, id)).filter(Boolean)} outline={BLUE} />}
          {overlay(s)}
        </Canvas>
        {editor}
      </main>
      {propsPanel(s)}
    </div>
  )
}

App.initialState = M.initialState()
App.calculated = {rows: [['shapes'], (s: State) => M.rows(s.shapes)]}
App.context = {selected: (s: State) => s.selection, renaming: (s: State) => s.renaming, drop: (s: State) => s.drop}

const KEYS = {
  'mod+z': 'UNDO', 'shift+mod+z': 'REDO', 'mod+y': 'REDO', 'mod+c': 'COPY', 'mod+v': 'PASTE', 'mod+d': 'DUPLICATE',
  'mod+a': 'SELECT_ALL', 'mod+=': 'ZOOM_IN', 'mod+-': 'ZOOM_OUT', 'mod+0': 'ZOOM_RESET', 'shift+1': 'ZOOM_FIT',
  v: ['TOOL', 'select'], r: ['TOOL', 'rect'], o: ['TOOL', 'ellipse'], t: ['TOOL', 'text'], f: ['TOOL', 'frame'],
  delete: 'DELETE', backspace: 'DELETE', escape: 'ESCAPE',
  left: ['NUDGE', {dx: -1, dy: 0}], right: ['NUDGE', {dx: 1, dy: 0}], up: ['NUDGE', {dx: 0, dy: -1}], down: ['NUDGE', {dx: 0, dy: 1}],
  'shift+left': ['NUDGE', {dx: -10, dy: 0}], 'shift+right': ['NUDGE', {dx: 10, dy: 0}], 'shift+up': ['NUDGE', {dx: 0, dy: -10}], 'shift+down': ['NUDGE', {dx: 0, dy: 10}],
} as const

App.intent = ({DOM, CHILD}: any) => {
  const board = DOM.select('.board'), key = keymap(DOM, KEYS as any)
  return {
    ...key,
    DOWN: board.events('pointerdown').map(pointer),
    MOVE: board.events('pointermove').map(pointer),
    UP: board.events('pointerup').map(pointer),
    DBL: board.events('dblclick').map(pointer),
    CAMERA: board.events('camerachange').detail(),
    RESIZE: board.events('canvasresize').detail(),
    TOOL: merge(DOM.click('.tool').data('tool'), key.TOOL),
    UNDO: merge(DOM.click('.undo'), key.UNDO),
    REDO: merge(DOM.click('.redo'), key.REDO),
    ZOOM_IN: merge(DOM.click('.zoom-in'), key.ZOOM_IN),
    ZOOM_OUT: merge(DOM.click('.zoom-out'), key.ZOOM_OUT),
    ZOOM_RESET: merge(DOM.click('.zoom-reset'), key.ZOOM_RESET),
    ZOOM_FIT: merge(DOM.click('.zoom-fit'), key.ZOOM_FIT),
    TEXT: DOM.input('.text-edit').value(),
    TEXT_DONE: merge(DOM.blur('.text-edit'), DOM.select('.text-edit').events('keydown').filter((e: any) => e.key == 'Escape')),
    PROP: DOM.select('.prop').events('change').map((e: any) => ({key: e.target.dataset.key, value: e.target.value})),
    EXPORT: DOM.click('.export').data('which'),
    STRESS: DOM.click('.stress').data('n', Number),
    LAYER: CHILD.select(LayerRow),
  }
}

const focusText = (s: State) => s.editing ? {focus: '.text-edit'} : ABORT

App.model = {
  DOWN: {STATE: M.down, ELEMENT: (s: State, _: any, __: any, {previousState}: any) => s.editing && !previousState.editing ? focusText(s) : ABORT},
  MOVE: M.move,
  UP: M.up,
  DBL: {STATE: M.dbl, ELEMENT: focusText},
  CAMERA: (s: State, camera: any) => ({...s, camera}),
  RESIZE: (s: State, size: any) => ({...s, size}),
  TOOL: (s: State, tool: M.Tool) => ({...s, tool}),
  UNDO: M.undo, REDO: M.redo,
  COPY: M.copy, PASTE: M.paste, DUPLICATE: M.duplicate, SELECT_ALL: M.selectAll,
  DELETE: M.del, ESCAPE: M.escape, NUDGE: M.nudge,
  ZOOM_IN: (s: State) => M.zoomBy(s, 2), ZOOM_OUT: (s: State) => M.zoomBy(s, 0.5),
  ZOOM_RESET: (s: State) => M.zoomTo(s, 1), ZOOM_FIT: M.zoomFit,
  TEXT: M.editText, TEXT_DONE: M.textDone,
  PROP: M.setProp,
  EXPORT: {EFFECT: (s: State, which: 'selection' | 'page') => download(M.exportSVG(s, which), which == 'page' ? 'page.svg' : 'selection.svg')},
  STRESS: M.loadStress,
  LAYER: M.layer,
}

/** the browser's download of a text file (an EFFECT: no driver needed for one-off output) */
function download(text: string, name: string) {
  const g: any = globalThis
  g.__lastExport = text
  if (!g.URL?.createObjectURL || /jsdom/i.test(g.navigator?.userAgent || '')) return
  const url = URL.createObjectURL(new Blob([text], {type: 'image/svg+xml'}))
  const a = document.createElement('a')
  a.href = url; a.download = name; a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

