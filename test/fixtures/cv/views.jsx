// CV-0 fixtures: views whose vnodes must be the same compiled (sygnal/vite `compile`) and not.
// Each export: [view, props]. Covers the pragma's routing, text and children rules and the
// bail-outs (components, markers, fragments, fields, SVG, refs, spreads, entities).
import { Collection, Switchable, createRef } from 'sygnal'

function Child({ label, children }) { return <em className="child">{label}{children}</em> }
function Item({ state }) { return <li>{state.id}</li> }
function U({ uid }) { return <b id={uid('x')}>u</b> }
const ref = createRef()
const rows = [{ id: 1, label: 'one' }, { id: 2, label: 'two <b>' }, { id: 3, label: '' }]

export const cases = {
  staticText: [() => <div>hello</div>, {}],
  empty: [() => <div />, {}],
  voidEls: [() => <p>a<br />b<hr /></p>, {}],
  staticAttrs: [() => <div className="a b" id="x" title="t" tabindex="0" role="button" for="f" />, {}],
  dupAttr: [({ t }) => <div title="a" className="c" title={t} />, { t: 'b' }],
  boolAttr: [() => <button disabled>go</button>, {}],
  dynClass: [({ on }) => <div className={on ? 'row danger' : 'row'}>x</div>, { on: true }],
  undefinedProp: [({ v }) => <div title={v} className={v}>x</div>, { v: undefined }],
  nullProp: [({ v }) => <div title={v}>x</div>, { v: null }],
  dataset: [({ id }) => <div data={{ id }} data-task-id={id + 1} data-x="s" />, { id: 7 }],
  aria: [({ b }) => <div aria-expanded={b} aria-label="l" aria-hidden={!b} aria-controls={b} />, { b: false }],
  ariaTrue: [({ b }) => <div aria-expanded={b} aria-pressed={b} />, { b: true }],
  modulePrefix: [({ h }) => <a attrs-href={h} props-title="t" class-active={true} style-color="red" />, { h: '/x' }],
  styleStatic: [() => <div style={{ color: 'red', marginTop: '1px' }} />, {}],
  styleDynamic: [({ c }) => <div style={{ color: c, opacity: undefined }} />, { c: 'blue' }],
  classString: [({ c }) => <div class={c} />, { c: 'a  b' }],
  classArray: [({ c }) => <div class={['a', c && 'b', ['c', { d: true, e: false }]]} />, { c: true }],
  classObject: [() => <div class={{ x: true, y: false }} className="z" />, {}],
  numberText: [({ n }) => <span>{n}</span>, { n: 42 }],
  zeroText: [({ n }) => <span>{n}</span>, { n: 0 }],
  mixedText: [({ n }) => <span>count: {n} items</span>, { n: 3 }],
  falsyChildren: [({ a }) => <div>{a && <b>yes</b>}{null}{undefined}{false}{''}{0}</div>, { a: false }],
  truthyChild: [({ a }) => <div>{a && <b>yes</b>}</div>, { a: true }],
  arrayChild: [() => <ul>{rows.map(r => <li key={r.id} className="r">{r.label}</li>)}</ul>, {}],
  singleTextArray: [() => <div>{['a']}</div>, {}],
  nestedArrays: [() => <div>{[['a', ['b']], <i>c</i>]}x</div>, {}],
  keyLiteral: [() => <div key="k1">a</div>, {}],
  keyExpr: [({ id }) => <div key={id}>a</div>, { id: 5 }],
  whitespace: [() => (
    <div>
      first line
      second   line
      <b> bold </b>  tail
      {' '}
      <i>x</i> <i>y</i>
    </div>
  ), {}],
  tabsAndBlankLines: [() => <p>	a	b

      c</p>, {}],
  templateAttr: [({ n }) => <div title={`n=${n}`} />, { n: 2 }],
  table: [({ rows, selected }) => (
    <div className="table">
      {rows.map(row => (
        <div className={row.id === selected ? 'row danger' : 'row'} key={row.id} data={{ id: row.id }}>
          <span className="col-id">{row.id}</span>
          <a className="lbl">{row.label}</a>
          <a className="remove">x</a>
        </div>
      ))}
    </div>
  ), { rows, selected: 2 }],
  // bail-outs and mixes
  component: [() => <div className="w"><Child label="c"><b>inner</b></Child></div>, {}],
  componentInMap: [() => <ul>{rows.map(r => <Child key={r.id} label={r.label} />)}</ul>, {}],
  collection: [() => <section><Collection of={Item} from="items" /></section>, {}],
  switchable: [({ t }) => <div><Switchable of={{ a: Item }} current={t} /></div>, { t: 'a' }],
  fragment: [() => <div><>a<b>b</b></>c</div>, {}],
  topFragment: [() => <><p>a</p><p>b</p></>, {}],
  input: [({ v }) => <form className="f"><input value={v} /><textarea>t</textarea><select><option>o</option></select></form>, { v: 'x' }],
  customEl: [() => <div><my-el foo="bar">c</my-el></div>, {}],
  svg: [() => <div><svg viewBox="0 0 1 1" className="i"><path d="M0 0" /></svg></div>, {}],
  refEl: [() => <div ref={ref}>r</div>, {}],
  autoFocus: [() => <div><button autoFocus>b</button></div>, {}],
  spread: [({ p }) => <div {...p}>s</div>, { p: { id: 'sp', title: 't' } }],
  entity: [() => <p>a &amp; b &lt; c</p>, {}],
  entityAttr: [() => <p title="a &amp; b">x</p>, {}],
  memberTag: [() => { const T = { X: Child }; return <div><T.X label="m" /></div> }, {}],
  insideComponentChildren: [() => <Child label="p"><div className="in">{1}</div></Child>, {}],
  conditionalElement: [({ a }) => (a ? <b className="t">t</b> : <i className="f">f</i>), { a: false }],
  uidPaths: [() => <div><span>a</span>{[<U />, [<U />, 'x']]}<p className="p">{null}<U /><i>{1}<U /></i></p><U key="k" /></div>, {}],
  innerHTML: [({ h }) => <div><p innerHTML={h} /></div>, { h: '<b>raw</b>' }],
  staticDeep: [() => <div><header className="h"><h1>T <em>i</em></h1><nav><a href="/a">A</a></nav></header><img src="x.png" alt="" /></div>, {}],
  escapes: [({ t }) => <div title={t} data-q={t}>{t}<b>{t}</b></div>, { t: `<a href="x">&'"` }],
  nested: [({ items }) => <main><header><h1>Title</h1></header><nav>{items.map(i => <a key={i} href={'#' + i}>{i}</a>)}</nav><footer>©</footer></main>, { items: ['a', 'b'] }],
}
