// @vitest-environment jsdom
import {it,expect,afterEach} from 'vitest'
import {renderComponent,createElement as h,byId} from '../src/index.ts'
import {setupChecks,diagnostics} from './diagnostics/helpers.js'
let t
afterEach(()=>t?.dispose())
for(const kind of ['id','path'])it(`replaces a changed ${kind} binding without a legacy warning`,async()=>{
 setupChecks()
 function Child({state}){return h('p',null,state.title)}
 function App({state}){return h(Child,{state:kind==='id'?byId('projects',state.selected):state.selected===1?'a':'b'})}
 App.initialState={selected:1,projects:[{id:1,title:'a'},{id:2,title:'b'}],a:{title:'a'},b:{title:'b'}}
 App.model={SELECT:(s,selected)=>({...s,selected}),TICK:s=>({...s})}
 t=renderComponent(App);await t.ready();t.simulateAction('TICK');await t.settle()
 expect(diagnostics('SYG454')).toHaveLength(0)
 t.simulateAction('SELECT',2);await t.settle();t.simulateAction('TICK');await t.settle()
 expect(diagnostics('SYG454')).toHaveLength(0)
 expect(t.html()).toContain('b')
})
it('does not warn for a changing keyed identity or equivalent freshly allocated lens',async()=>{
 setupChecks()
 function Child({state}){return h('p',null,state.title)}
 function App({state}){return h(Child,{key:state.selected,state:byId('projects',state.selected)})}
 App.initialState={selected:1,projects:[{id:1,title:'a'},{id:2,title:'b'}]};App.model={SELECT:(s,selected)=>({...s,selected}),TICK:s=>({...s})}
 t=renderComponent(App);await t.ready();t.simulateAction('TICK');t.simulateAction('SELECT',2);await t.settle()
 expect(diagnostics('SYG454')).toHaveLength(0)
})
it('keeps byId metadata private and does not warn on arbitrary inline custom lenses',async()=>{
 setupChecks();expect(Object.keys(byId('projects',1))).toEqual(['get','set'])
 function Child({state}){return h('p',null,state.title)}
 function App(){return h(Child,{state:{get:s=>s.a,set:(s,a)=>({...s,a})}})}
 App.initialState={a:{title:'a'}};App.model={TICK:s=>({...s})}
 t=renderComponent(App);await t.ready();t.simulateAction('TICK');await t.settle();expect(diagnostics('SYG454')).toHaveLength(0)
})

it('keyed master-detail edits, fake AI results and persistence stay on the selected project',async()=>{
 setupChecks()
 const {Collection,persist}=await import('../src/index.ts')
 const storage=new Map(), store={getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)}
 function Item({state}){return h('button',{className:'item'},state.title)}
 Item.intent=({DOM})=>({EDIT:DOM.click('.item')});Item.model={EDIT:s=>({...s,title:s.title+'!'})}
 function Editor(){return h('div',null,h('button',{className:'ai'},'apply AI'),h(Collection,{of:Item,from:'tasks'}))}
 Editor.intent=({DOM})=>({AI:DOM.click('.ai').mapTo('generated')})
 Editor.model={AI:(s,title)=>({...s,title})}
 function App({state}){return h(Editor,{key:state.selected,state:byId('projects',state.selected)})}
 App.initialState={selected:1,projects:[{id:1,title:'one',tasks:[{id:1,title:'a'}]},{id:2,title:'two',tasks:[{id:2,title:'b'}]}]}
 App.model={SELECT:(s,selected)=>({...s,selected}),CREATE:s=>({...s,selected:3,projects:[...s.projects,{id:3,title:'three',tasks:[{id:3,title:'c'}]}]})}
 App.persist=persist({key:'p11-projects',storage:store,debounceMs:0})
 t=renderComponent(App,{sinkState:'after'});await t.ready()
 const original=t.state.projects[0]
 t.simulateAction('SELECT',2);await t.settle()
 t.simulateEvent('.item','click');await t.settle()
 t.simulateAction('CREATE');await t.settle()
 t.simulateEvent('.ai','click');await t.settle()
 t.simulateEvent('.item','click');await t.settle()
 expect(t.state.projects.map(p=>[p.title,p.tasks[0].title])).toEqual([['one','a'],['two','b!'],['generated','c!']])
 expect(t.state.projects[0]).toEqual(original)
 await new Promise(resolve=>setTimeout(resolve,20))
 const saved=t.state;t.dispose()
 t=renderComponent(App,{sinkState:'after'});await t.ready();await t.settle()
 expect(t.state).toEqual(saved);expect(t.html()).toContain('c!')
 expect(diagnostics('SYG454')).toHaveLength(0)
})
