// @vitest-environment jsdom
import {it,expect,vi} from 'vitest'
import {mount,h,click,until,api,Collection,Switchable,microtasks,makeFetchDriver} from './parity/harness.js'
const flush=async m=>{await m.app.__runtime.flushed();await microtasks()}
const select=async(m,id=2)=>{m.app.__runtime.dispatch('root','SELECT',id);await flush(m)}
const child=m=>m.app.__runtime.root.children()[0]
function setup(binding,{keyed=false}={}){
 const seen=[],life=[]
 function Editor({state,context}){return h('button',{className:'edit'},state.title+':'+context.label)}
 Editor.context={label:s=>s?.title};Editor.calculated={upper:s=>s.title.toUpperCase()}
 Editor.intent=({DOM,STATE})=>{STATE.stream.addListener({next:s=>seen.push(s.title)});return {EDIT:DOM.click('.edit')}}
 Editor.model={EDIT:s=>({...s,title:s.title+'!'})}
 function App({state}){return h('div',null,h(Editor,{state:binding(state),...(keyed&&{key:'stable'})}))}
 App.initialState={selected:1,a:{title:'one'},b:{title:'two'},projects:[{id:1,title:'one'},{id:2,title:'two'}]}
 App.model={SELECT:(s,selected)=>({...s,selected}),TICK:s=>({...s})}
 const m=mount(App,{}, {__hooks:{onCreate:i=>life.push(['create',i.id]),onDispose:i=>life.push(['dispose',i.id])}})
 return {m,seen,life}
}
for(const [name,binding] of [['byId',s=>api.byId('projects',s.selected)],['path',s=>s.selected===1?'a':'b']]){
 it(`${name}: changes lifetime, streams, context, calculated state and writes`,async()=>{
  const {m,seen,life}=setup(binding);await flush(m);const id=child(m).id
  await select(m);expect(child(m).id).not.toBe(id);expect(life).toContainEqual(['dispose',id]);expect(m.text('.edit')).toBe('two:two');expect(seen.at(-1)).toBe('two');expect(child(m).state.upper).toBe('TWO')
  click(m.$('.edit'));await flush(m);expect(m.text('.edit')).toBe('two!:two!');await select(m,1);expect(m.text('.edit')).toBe('one:one')
 })
}
it('explicit stable key does not suppress changed binding; fresh equivalent helper preserves identity',async()=>{
 const {m}=setup(s=>api.byId('projects',s.selected),{keyed:true});await flush(m);const id=child(m).id
 m.app.__runtime.dispatch('root','TICK');await flush(m);expect(child(m).id).toBe(id)
 await select(m);expect(child(m).id).not.toBe(id)
})
it('opaque custom and read-only lens allocations remain mount-bound without false remounts',async()=>{
 for(const writable of [false,true]){
  const {m}=setup(s=>({get:p=>p.projects.find(x=>x.id===s.selected),...(writable&&{set:(p,v)=>({...p,projects:p.projects.map(x=>x.id===s.selected?v:x)})})}));await flush(m);const id=child(m).id
  await select(m);expect(child(m).id).toBe(id);expect(m.text('.edit')).toBe('one:one');click(m.$('.edit'));await flush(m);expect(m.state().projects.map(p=>p.title)).toEqual(writable?['one!','two']:['one','two']);m.app.dispose();m.el.remove()
 }
})
it('missing byId target clears markup, reappearing target creates valid state',async()=>{
 const {m}=setup(s=>api.byId('projects',s.selected));await flush(m);await select(m,3);expect(m.text('.edit')).toBeUndefined();expect(child(m).state).toBeUndefined();await select(m,2);expect(m.text('.edit')).toBe('two:two')
})
it('isolated new path seeds missing target once using existing creation rules',async()=>{
 function Editor({state}){return h('p',{className:'title'},state.title)}
 Editor.isolatedState=true;Editor.initialState={title:'default'};Editor.model={EDIT:s=>({...s,title:'edited'})}
 function App({state}){return h(Editor,{state:state.selected===1?'a':'b'})}
 App.initialState={selected:1,a:{title:'one'}};App.model={SELECT:(s,selected)=>({...s,selected})}
 const m=mount(App);await flush(m);await select(m);expect(m.state().b).toEqual({title:'default'});expect(m.text('.title')).toBe('default');m.app.__runtime.dispatch(child(m),'EDIT');await flush(m);await select(m,1);await select(m,2);expect(m.state().b).toEqual({title:'edited'});expect(m.text('.title')).toBe('edited')
})
it('old HTTP response is aborted and late completion cannot mutate either entity',async()=>{
 const calls=[];const fetch=vi.fn((url,init)=>new Promise(resolve=>calls.push({url,init,resolve})))
 function Editor({state}){return h('p',null,state.title)}
 Editor.model={LOAD:{HTTP:s=>({url:'/project/'+s.id,ok:'GOT',latest:true})},GOT:(s,d)=>({...s,title:d.title})}
 function App({state}){return h(Editor,{state:api.byId('projects',state.selected)})}
 App.initialState={selected:1,projects:[{id:1,title:'one'},{id:2,title:'two'}]};App.model={SELECT:(s,selected)=>({...s,selected})}
 const m=mount(App,{HTTP:makeFetchDriver({fetch})});await flush(m);m.app.__runtime.dispatch(child(m),'LOAD');await until(()=>expect(calls).toHaveLength(1));await select(m);await until(()=>expect(calls[0].init.signal.aborted).toBe(true));calls[0].resolve(new Response(JSON.stringify({title:'late'}),{headers:{'Content-Type':'application/json'}}));await flush(m);expect(m.state().projects.map(p=>p.title)).toEqual(['one','two'])
})
it('old timer, captured next and effect signal end with lifetime',async()=>{
 let captured,signal
 function Editor({state}){return h('p',null,state.title)}
 Editor.model={START:{EFFECT:(s,d,next,p)=>{captured=next;signal=p.signal;next('GOT','timer',20)}},GOT:(s,title)=>({...s,title})}
 function App({state}){return h(Editor,{state:api.byId('projects',state.selected)})}
 App.initialState={selected:1,projects:[{id:1,title:'one'},{id:2,title:'two'}]};App.model={SELECT:(s,selected)=>({...s,selected})}
 const m=mount(App);await flush(m);m.app.__runtime.dispatch(child(m),'START');await select(m);expect(signal.aborted).toBe(true);captured('GOT','late');await new Promise(r=>setTimeout(r,35));await flush(m);expect(m.state().projects.map(p=>p.title)).toEqual(['one','two'])
})
it('descendant streams restart and nested Collection binds to new entity',async()=>{
 const seen=[]
 function Item({state}){return h('button',{className:'item'},state.title)}
 Item.intent=({DOM,STATE})=>{STATE.stream.addListener({next:s=>seen.push(s.title)});return{EDIT:DOM.click('.item')}};Item.model={EDIT:s=>({...s,title:s.title+'!'})}
 function Workspace(){return h(Collection,{of:Item,from:'tasks'})}
 function App({state}){return h(Workspace,{state:api.byId('projects',state.selected)})}
 App.initialState={selected:1,projects:[{id:1,tasks:[{id:1,title:'one'}]},{id:2,tasks:[{id:1,title:'two'}]}]};App.model={SELECT:(s,selected)=>({...s,selected})}
 const m=mount(App);await flush(m);await select(m);expect(seen.at(-1)).toBe('two');click(m.$('.item'));await flush(m);expect(m.state().projects.map(p=>p.tasks[0].title)).toEqual(['one','two!'])
})
for(const host of ['Collection','Switchable'])it(`${host} binding changes dispose all old lifetimes, including overlapping IDs and hidden pages`,async()=>{
 const life=[],seen=[]
 function Item({state}){return h('button',{className:'item'},state.title)}
 Item.intent=({DOM,STATE})=>{STATE.stream.addListener({next:s=>seen.push(s.title)});return{EDIT:DOM.click('.item')}};Item.model={EDIT:s=>({...s,title:s.title+'!'})}
 function App({state}){return host==='Collection'?h(Collection,{of:Item,from:state.selected===1?'a':'b'}):h(Switchable,{of:{shown:Item,hidden:Item},current:'shown',state:api.byId('projects',state.selected)})}
 App.initialState={selected:1,a:[{id:1,title:'one'}],b:[{id:1,title:'two'}],projects:[{id:1,title:'one'},{id:2,title:'two'}]};App.model={SELECT:(s,selected)=>({...s,selected})}
 const m=mount(App,{}, {__hooks:{onCreate:i=>life.push(['create',i.id]),onDispose:i=>life.push(['dispose',i.id])}});await flush(m);const old=m.app.__runtime.root.children().map(i=>i.id)
 await select(m);expect(m.text('.item')).toBe('two');for(const id of old)expect(life).toContainEqual(['dispose',id]);click(m.$('.item'));await flush(m);expect(host==='Collection'?m.state().b[0].title:m.state().projects[1].title).toBe('two!');expect(seen.at(-1)).toBe('two!')
})
it('a missing selected entity at the DOM root clears output without stopping future patches',async()=>{
 function Editor({state}){return h('p',{className:'title'},state.title)}
 function App({state}){return h(Editor,{state:api.byId('projects',state.selected)})}
 App.initialState={selected:1,projects:[{id:1,title:'one'},{id:2,title:'two'}]};App.model={SELECT:(s,selected)=>({...s,selected})}
 const m=mount(App);await flush(m);await select(m,3);expect(m.text('.title')).toBeUndefined();await select(m,2);expect(m.text('.title')).toBe('two')
})
it('VirtualCollection from target resets the item lifetime rather than reusing an overlapping ID',async()=>{
 const life=[]
 function Item({state}){return h('p',{className:'vitem'},state.title)}
 function App({state}){return h('div',null,h(api.VirtualCollection,{of:Item,from:state.selected===1?'a':'b',estimateSize:30,style:{height:'100px'}}))}
 App.initialState={selected:1,a:[{id:1,title:'one'}],b:[{id:1,title:'two'}]};App.model={SELECT:(s,selected)=>({...s,selected})}
 const m=mount(App,{}, {__hooks:{onDispose:i=>life.push(i.id)}});await flush(m);const old=child(m).id;await select(m);expect(m.text('.vitem')).toBe('two');expect(child(m).id).not.toBe(old);expect(life).toContain(old)
})
it('selection churn retains one patch per change and bounded live instance count',async()=>{
 const {m,life}=setup(s=>api.byId('projects',s.selected));await flush(m);const start=m.patches()
 for(let i=0;i<100;i++)await select(m,i%2?1:2)
 expect(m.patches()-start).toBe(100)
 expect(life.filter(x=>x[0]==='create').length-life.filter(x=>x[0]==='dispose').length).toBe(2)
})
for(const binding of ['byId','path'])it(`unchanged ${binding} target deletion disposes once, clears and can reappear`,async()=>{
 const life=[],signals=[];let late
 function Editor({state}){return h('p',{className:'same-id'},state.title)}
 Editor.model={START:{EFFECT:(s,d,next,p)=>{late=next;signals.push(p.signal);next('GOT','stale',20)}},GOT:(s,title)=>({...s,title})}
 function App(){return h(Editor,{state:binding==='byId'?api.byId('projects',1):'record'})}
 App.initialState={projects:[{id:1,title:'one'}],record:{title:'one'}}
 App.model={DROP:s=>({...s,projects:[],record:undefined}),TICK:s=>({...s}),RESTORE:s=>({...s,projects:[{id:1,title:'two'}],record:{title:'two'}})}
 const m=mount(App,{}, {__hooks:{onCreate:i=>life.push(['create',i.id]),onDispose:i=>life.push(['dispose',i.id])}});await flush(m);const old=child(m).id;m.app.__runtime.dispatch(child(m),'START');m.app.__runtime.dispatch('root','DROP');await flush(m)
 expect(m.text('.same-id')).toBeUndefined();expect(signals[0].aborted).toBe(true);expect(life).toContainEqual(['dispose',old]);const count=life.length,waiting=child(m).id
 for(let i=0;i<3;i++){m.app.__runtime.dispatch('root','TICK');await flush(m)}expect(life).toHaveLength(count)
 m.app.__runtime.dispatch('root','RESTORE');await flush(m);expect(child(m).id).toBe(waiting);expect(m.text('.same-id')).toBe('two');late('GOT','stale');await new Promise(r=>setTimeout(r,30));await flush(m);expect(m.text('.same-id')).toBe('two')
})
for(const binding of ['byId','path'])it(`Switchable unchanged ${binding} disappearance aborts hidden work without absence loops`,async()=>{
 const signals=[];let late
 function Page({state}){return h('p',{className:'same-page'},state.title)}
 Page.intent=()=>({START:api.xs.of(null)})
 Page.model={START:{EFFECT:(s,d,next,p)=>{signals.push(p.signal);late=next}},GOT:(s,title)=>({...s,title})}
 function App(){return h(Switchable,{of:{shown:Page,hidden:Page},current:'shown',state:binding==='byId'?api.byId('projects',1):'record'})}
 App.initialState={projects:[{id:1,title:'one'}],record:{title:'one'}};App.model={DROP:s=>({...s,projects:[],record:undefined}),TICK:s=>({...s}),RESTORE:s=>({...s,projects:[{id:1,title:'two'}],record:{title:'two'}})}
 const m=mount(App);await flush(m);const old=signals.slice();expect(old).toHaveLength(2);m.app.__runtime.dispatch('root','DROP');await flush(m);expect(m.text('.same-page')).toBeUndefined();expect(old.every(s=>s.aborted)).toBe(true);const count=signals.length
 m.app.__runtime.dispatch('root','TICK');await flush(m);expect(signals).toHaveLength(count);m.app.__runtime.dispatch('root','RESTORE');await flush(m);expect(m.text('.same-page')).toBe('two')
})
it('isolated defaults do not conceal disappearance from disposal and pending-work ownership',async()=>{
 let signal,late
 const created=[]
 function Editor({state}){return h('p',{className:'defaulted'},state.title)}
 Editor.isolatedState=true;Editor.initialState={title:'default'}
 Editor.model={START:{EFFECT:(s,d,next,p)=>{signal=p.signal;late=next}},GOT:(s,title)=>({...s,title})}
 function App(){return h(Editor,{state:api.byId('projects',1)})}
 App.initialState={projects:[{id:1,title:'one'}]};App.model={DROP:s=>({...s,projects:[]}),TICK:s=>({...s}),RESTORE:s=>({...s,projects:[{id:1,title:'two'}]})}
 const m=mount(App,{}, {__hooks:{onCreate:i=>created.push(i.id)}});await flush(m);m.app.__runtime.dispatch(child(m),'START');m.app.__runtime.dispatch('root','DROP');await flush(m);expect(signal.aborted).toBe(true);expect(m.text('.defaulted')).toBe('default');const n=created.length;m.app.__runtime.dispatch('root','TICK');await flush(m);expect(created).toHaveLength(n);m.app.__runtime.dispatch('root','RESTORE');await flush(m);late('GOT','stale');await flush(m);expect(m.text('.defaulted')).toBe('two')
})
it('a null-rendering known lifetime still ends on disappearance, while null state itself is present',async()=>{
 const signals=[],nexts=[]
 function Editor(){return null}
 Editor.intent=()=>({START:api.xs.of(null)})
 Editor.model={START:{EFFECT:(s,d,next,p)=>{signals.push(p.signal);nexts.push(next)}},GOT:(s,title)=>({title})}
 function App(){return h(Editor,{state:'record'})}
 App.initialState={record:{title:'one'}};App.model={NULL:s=>({...s,record:null}),DROP:s=>({...s,record:undefined}),RESTORE:s=>({...s,record:{title:'two'}})}
 const m=mount(App);await flush(m);expect(signals).toHaveLength(1);const first=child(m).id;m.app.__runtime.dispatch('root','NULL');await flush(m);expect(child(m).id).toBe(first);expect(signals[0].aborted).toBe(false);m.app.__runtime.dispatch('root','DROP');await flush(m);expect(signals[0].aborted).toBe(true);expect(child(m).id).not.toBe(first);m.app.__runtime.dispatch('root','RESTORE');await flush(m);nexts[0]('GOT','stale');await flush(m);expect(m.state().record.title).toBe('two')
})
