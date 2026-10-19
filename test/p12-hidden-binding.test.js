// @vitest-environment jsdom
import {it,expect} from 'vitest'
import {mount,h,api,Switchable,microtasks} from './parity/harness.js'
const flush=async m=>{await m.app.__runtime.flushed();await microtasks()}
it('disposes a deleted known-bound child while its containing page is hidden',async()=>{
 let signal,next
 function Editor({state}){return h('p',{className:'title'},state.title)}
 Editor.model={START:{EFFECT:(s,d,n,p)=>{signal=p.signal;next=n}},GOT:(s,title)=>({...s,title})}
 function Detail({state}){return h(Editor,{state:api.byId('projects',state.selected)})}
 function Other(){return h('p',null,'other')}
 function App({state}){return h(Switchable,{of:{detail:Detail,other:Other},current:state.page})}
 App.initialState={page:'detail',selected:1,projects:[{id:1,title:'one'}]}
 App.model={HIDE:s=>({...s,page:'other'}),DROP:s=>({...s,projects:[]}),RESTORE:s=>({...s,projects:[{id:1,title:'two'}]})}
 const m=mount(App);await flush(m)
 const detail=m.app.__runtime.root.children().find(i=>i.name==='Detail');const editor=detail.children()[0]
 m.app.__runtime.dispatch(editor,'START');m.app.__runtime.dispatch('root','HIDE');await flush(m)
 m.app.__runtime.dispatch('root','DROP');await flush(m)
 expect(signal.aborted).toBe(true)
})
it('old hidden child work cannot overwrite a reinserted same-ID record',async()=>{
 let next
 function Editor({state}){return h('p',null,state.title)}
 Editor.model={START:{EFFECT:(s,d,n)=>{next=n}},GOT:(s,title)=>({...s,title})}
 function Detail({state}){return h(Editor,{state:api.byId('projects',1)})}
 function Other(){return h('p',null,'other')}
 function App({state}){return h(Switchable,{of:{detail:Detail,other:Other},current:state.page})}
 App.initialState={page:'detail',projects:[{id:1,title:'one'}]};App.model={HIDE:s=>({...s,page:'other'}),DROP:s=>({...s,projects:[]}),RESTORE:s=>({...s,projects:[{id:1,title:'two'}]})}
 const m=mount(App);await flush(m);m.app.__runtime.dispatch(m.app.__runtime.root.children().find(i=>i.name==='Detail').children()[0],'START');m.app.__runtime.dispatch('root','HIDE');await flush(m);m.app.__runtime.dispatch('root','DROP');await flush(m);m.app.__runtime.dispatch('root','RESTORE');await flush(m);next('GOT','stale');await new Promise(r=>setTimeout(r,20));await flush(m);expect(m.state().projects[0].title).toBe('two')

})
it('disposes nested Switchable pages when their known target disappears under a hidden owner',async()=>{
 const signals=[];let late
 function Editor({state}){return h('p',null,state.title)}
 Editor.model={START:{EFFECT:(s,d,next,p)=>{signals.push(p.signal);late=next}},GOT:(s,title)=>({...s,title})}
 Editor.intent=()=>({START:api.xs.of(null)})
 function Detail(){return h(Switchable,{of:{shown:Editor,hidden:Editor},current:'shown',state:api.byId('projects',1)})}
 function Other(){return h('p',null,'other')}
 function App({state}){return h(Switchable,{of:{detail:Detail,other:Other},current:state.page})}
 App.initialState={page:'detail',projects:[{id:1,title:'one'}]};App.model={HIDE:s=>({...s,page:'other'}),DROP:s=>({...s,projects:[]}),RESTORE:s=>({...s,projects:[{id:1,title:'two'}]})}
 const m=mount(App);await flush(m);const old=signals.slice();m.app.__runtime.dispatch('root','HIDE');await flush(m);m.app.__runtime.dispatch('root','DROP');await flush(m);expect(old.every(s=>s.aborted)).toBe(true)
})

it('defers a fresh hidden missing lifetime until show, then initializes it once', async () => {
  const initialized = [], bootstrapped = []
  function Editor({state}) { return h('p', {className: 'title'}, state.title) }
  Editor.model = {
    INITIALIZE: state => { initialized.push(state?.id); return state },
    BOOTSTRAP: {EFFECT: state => { bootstrapped.push(state?.id) }},
  }
  function Detail() { return h(Editor, {state: api.byId('projects', 1)}) }
  function Other() { return h('p', null, 'other') }
  const pages = {detail: Detail, other: Other}
  function App({state}) { return h(Switchable, {of: pages, current: state.page}) }
  App.initialState = {page: 'detail', projects: [{id: 1, title: 'one'}]}
  App.model = {
    HIDE: state => ({...state, page: 'other'}),
    DROP: state => ({...state, projects: []}),
    SHOW: state => ({...state, page: 'detail'}),
    TICK: state => ({...state}),
    RESTORE: state => ({...state, projects: [{id: 1, title: 'two'}]}),
  }
  const m = mount(App)
  await flush(m)
  expect(initialized).toEqual([1]); expect(bootstrapped).toEqual([1])
  m.app.__runtime.dispatch('root', 'HIDE'); await flush(m)
  m.app.__runtime.dispatch('root', 'DROP'); await flush(m)
  expect(initialized).toEqual([1]); expect(bootstrapped).toEqual([1])
  m.app.__runtime.dispatch('root', 'SHOW'); await flush(m)
  expect(m.text('.title')).toBeUndefined()
  expect(initialized).toEqual([1, undefined]); expect(bootstrapped).toEqual([1, undefined])
  m.app.__runtime.dispatch('root', 'TICK'); await flush(m)
  m.app.__runtime.dispatch('root', 'RESTORE'); await flush(m)
  expect(m.text('.title')).toBe('two')
  expect(initialized).toHaveLength(2); expect(bootstrapped).toHaveLength(2)
})

it('reconciles a hidden owner after restoring its exact previous state object', async () => {
  const data = {projects: [{id: 1, title: 'one'}]}
  let oldSignal
  function Editor({state}) { return h('button', {className: 'edit'}, state.title) }
  Editor.intent = ({DOM}) => ({EDIT: DOM.click('.edit')})
  Editor.model = {START: {EFFECT: (_state, _data, _next, props) => { oldSignal = props.signal }}, EDIT: state => ({...state, title: state.title + '!'})}
  function Detail() { return h(Editor, {state: api.byId('projects', 1)}) }
  function Other() { return h('p', null, 'other') }
  const pages = {detail: Detail, other: Other}
  function App({state}) { return h(Switchable, {of: pages, current: state.page, state: 'data'}) }
  App.initialState = {page: 'detail', data}
  App.model = {
    HIDE: state => ({...state, page: 'other'}),
    DROP: state => ({...state, data: {projects: []}}),
    RESTORE: state => ({...state, data}),
    SHOW: state => ({...state, page: 'detail'}),
  }
  const m = mount(App)
  await flush(m)
  const detail = m.app.__runtime.root.children().find(i => i.name === 'Detail')
  const editor = detail.children()[0]
  m.app.__runtime.dispatch(editor, 'START')
  m.app.__runtime.dispatch('root', 'HIDE'); await flush(m)
  m.app.__runtime.dispatch('root', 'DROP'); await flush(m)
  expect(oldSignal.aborted).toBe(true)
  m.app.__runtime.dispatch('root', 'RESTORE'); await flush(m)
  m.app.__runtime.dispatch('root', 'SHOW'); await flush(m)
  expect(detail.children()[0].id).not.toBe(editor.id)
  m.$('.edit').click(); await flush(m)
  expect(m.text('.edit')).toBe('one!')
})
