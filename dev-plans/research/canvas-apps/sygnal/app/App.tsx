/**
 * Figma-lite on Sygnal + the sygnal/canvas prototype (lib/canvas): the root component.
 * State, intents and the model's wiring; the reducers are in model.ts, the document in doc.ts.
 */
import {ABORT, Collection, VirtualCollection, xs} from 'sygnal'
import {Canvas, pointer, toScreen} from '../lib/canvas'
import {LayerRow} from './LayerRow'
import {ShapeNode} from './ShapeNode'
import {byId} from './doc'
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
    out.push(<rect className="sel-box" space="screen" {...screenBox(box)} fill="none" stroke={BLUE} strokeWidth={1.5} pointerEvents="none" />)
    const moving = s.gesture?.kind == 'move' && s.gesture.moved
    if (!moving) {
      for (const [part, [u, v]] of Object.entries(M.HANDLES)) {
        const p = toScreen(cam, ...(Object.values(M.boxPoint(box, u, v)) as [number, number]))
        out.push(<rect className="handle" data={{part}} aria-label={`Resize ${part}`} space="screen" x={p.x - 4} y={p.y - 4} width={8} height={8} rotation={box.rotation || 0} fill="#fff" stroke={BLUE} strokeWidth={1} />)
      }
      const r = M.boxPoint(box, 0.5, 0, -M.ROTATE_OFFSET / z), p = toScreen(cam, r.x, r.y)
      out.push(<ellipse className="handle rotate" data={{part: 'rotate'}} aria-label="Rotate" space="screen" x={p.x - 5} y={p.y - 5} width={10} height={10} fill="#fff" stroke={BLUE} strokeWidth={1} />)
    }
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
        <label className="lab">drag <select className="input-mode" value={s.input}><option value="queue">actions</option><option value="transient">transient</option></select></label>
        <label className="lab">paint <select className="repaint-mode" value={s.repaint}><option value="layers">layers</option><option value="full">full</option></select></label>
        <span className="count">{s.shapes.length} layers</span>
      </header>
      <aside className="layers-panel" aria-label="Layers">
        <h2>Layers</h2>
        <VirtualCollection of={LayerRow} from="rows" className="layers" estimateSize={26} aria-label="Layers" />
      </aside>
      <main className={'stage tool-' + s.tool}>
        <Canvas className="board" camera={s.camera} grid repaint={s.repaint} follow={g?.follow || null}>
          {s.render == 'collection'
            ? <Collection of={ShapeNode} from="shapes" />
            : <shapes className="doc" items={s.shapes} active={active} />}
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

const TYPING = (t: any) => /^(INPUT|TEXTAREA|SELECT)$/.test(t?.tagName) || t?.isContentEditable
/** a keydown → [action, data] when it is one of the editor's shortcuts */
export function shortcut(e: any): [string, any?] | null {
  if (TYPING(e.target)) return null
  const mod = e.metaKey || e.ctrlKey, k = (e.key || '').toLowerCase()
  if (mod) {
    if (k == 'z') return [e.shiftKey ? 'REDO' : 'UNDO']
    if (k == 'y') return ['REDO']
    if (k == 'c') return ['COPY']
    if (k == 'v') return ['PASTE']
    if (k == 'd') return ['DUPLICATE']
    if (k == 'a') return ['SELECT_ALL']
    if (k == '=' || k == '+') return ['ZOOM_IN']
    if (k == '-') return ['ZOOM_OUT']
    if (k == '0') return ['ZOOM_RESET']
    return null
  }
  if (e.shiftKey && e.code == 'Digit1') return ['ZOOM_FIT']
  const tool = ({v: 'select', r: 'rect', o: 'ellipse', t: 'text', f: 'frame'} as any)[k]
  if (tool && !e.altKey) return ['TOOL', tool]
  if (k == 'delete' || k == 'backspace') return ['DELETE']
  if (k == 'escape') return ['ESCAPE']
  const step = e.shiftKey ? 10 : 1
  const arrows: any = {arrowleft: [-step, 0], arrowright: [step, 0], arrowup: [0, -step], arrowdown: [0, step]}
  if (arrows[k]) return ['NUDGE', {dx: arrows[k][0], dy: arrows[k][1]}]
  return null
}

App.intent = ({DOM, CHILD}: any) => {
  const board = DOM.select('.board')
  const keys = DOM.select('document').events('keydown', {preventDefault: (e: any) => !!shortcut(e)}).map(shortcut).filter(Boolean)
  const key = (a: string) => keys.filter((k: any) => k[0] == a).map((k: any) => k[1])
  return {
    DOWN: board.events('pointerdown').map(pointer),
    MOVE: board.events('pointermove').map(pointer),
    UP: board.events('pointerup').map(pointer),
    DBL: board.events('dblclick').map(pointer),
    CAMERA: board.events('camerachange').detail(),
    RESIZE: board.events('canvasresize').detail(),
    TOOL: DOM.click('.tool').data('tool'),
    KEY_TOOL: key('TOOL'),
    UNDO: xsMerge(DOM.click('.undo'), key('UNDO')),
    REDO: xsMerge(DOM.click('.redo'), key('REDO')),
    COPY: key('COPY'), PASTE: key('PASTE'), DUPLICATE: key('DUPLICATE'), SELECT_ALL: key('SELECT_ALL'),
    DELETE: key('DELETE'), ESCAPE: key('ESCAPE'), NUDGE: key('NUDGE'),
    ZOOM_IN: xsMerge(DOM.click('.zoom-in'), key('ZOOM_IN')),
    ZOOM_OUT: xsMerge(DOM.click('.zoom-out'), key('ZOOM_OUT')),
    ZOOM_RESET: xsMerge(DOM.click('.zoom-reset'), key('ZOOM_RESET')),
    ZOOM_FIT: xsMerge(DOM.click('.zoom-fit'), key('ZOOM_FIT')),
    TEXT: DOM.input('.text-edit').value(),
    TEXT_DONE: xsMerge(DOM.blur('.text-edit'), DOM.select('.text-edit').events('keydown').filter((e: any) => e.key == 'Escape')),
    PROP: DOM.select('.prop').events('change').map((e: any) => ({key: e.target.dataset.key, value: e.target.value})),
    EXPORT: DOM.click('.export').data('which'),
    STRESS: DOM.click('.stress').data('n', Number),
    INPUT_MODE: DOM.select('.input-mode').events('change').value(),
    REPAINT_MODE: DOM.select('.repaint-mode').events('change').value(),
    LAYER: CHILD.select(LayerRow),
    SHAPE: CHILD.select(ShapeNode),
  }
}

const xsMerge = (...s: any[]) => xs.merge(...s)

const focusText = (s: State) => s.editing ? {focus: '.text-edit'} : ABORT

App.model = {
  DOWN: {STATE: M.down, ELEMENT: (s: State, _: any, __: any, {previousState}: any) => s.editing && !previousState.editing ? focusText(s) : ABORT},
  MOVE: M.move,
  UP: M.up,
  DBL: {STATE: M.dbl, ELEMENT: focusText},
  CAMERA: (s: State, camera: any) => ({...s, camera}),
  RESIZE: (s: State, size: any) => ({...s, size}),
  TOOL: (s: State, tool: M.Tool) => ({...s, tool}),
  KEY_TOOL: (s: State, tool: M.Tool) => ({...s, tool}),
  UNDO: M.undo, REDO: M.redo,
  COPY: M.copy, PASTE: M.paste, DUPLICATE: M.duplicate, SELECT_ALL: M.selectAll,
  DELETE: M.del, ESCAPE: M.escape, NUDGE: M.nudge,
  ZOOM_IN: (s: State) => M.zoomBy(s, 2), ZOOM_OUT: (s: State) => M.zoomBy(s, 0.5),
  ZOOM_RESET: (s: State) => M.zoomTo(s, 1), ZOOM_FIT: M.zoomFit,
  TEXT: M.editText, TEXT_DONE: M.textDone,
  PROP: M.setProp,
  EXPORT: {EFFECT: (s: State, which: 'selection' | 'page') => download(M.exportSVG(s, which), which == 'page' ? 'page.svg' : 'selection.svg')},
  STRESS: M.loadStress,
  INPUT_MODE: (s: State, input: any) => ({...s, input}),
  REPAINT_MODE: (s: State, repaint: any) => ({...s, repaint}),
  LAYER: M.layer,
  SHAPE: (s: State, m: {hover: string}) => s.gesture || s.hover === m.hover ? ABORT : {...s, hover: m.hover},
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

