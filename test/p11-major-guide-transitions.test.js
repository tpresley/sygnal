// @vitest-environment jsdom
// Run the actual guide reducers so after-default migrations cannot drift from their examples.
import fs from 'node:fs'
import {it,expect,afterEach} from 'vitest'
import {renderComponent,createElement as h,ABORT,event,Collection} from '../src/index.ts'
const model=(file,name,pick=()=>true)=>{
 const source=fs.readFileSync(new URL('../docs/src/content/docs/guide/'+file,import.meta.url),'utf8')
 const entries=[...source.matchAll(new RegExp(name+'\\.model = (\\{[\\s\\S]*?\\n\\})','g'))]
 const entry=entries.find(m=>pick(m[1]));expect(entry).toBeTruthy()
 return new Function('ABORT','event','return ('+entry[1]+')')(ABORT,event)
}
let t
afterEach(()=>{t?.dispose();t=null})
it('HTTP guide sends updated optimistic value and keeps the previous value for rollback',async()=>{
 function Todos(){return h('div')}
 Todos.initialState={todos:[{id:1,title:'Write',done:false}],error:''};Todos.model=model('http.md','Todos')
 t=renderComponent(Todos);await t.ready();t.simulateAction('TOGGLE',1);await t.settle()
 const request=t.requests('HTTP')[0];expect(request.json).toEqual({done:true});expect(request.before.done).toBe(false)
 await t.fail('HTTP',500);await t.settle();expect(t.state.todos[0].done).toBe(false)
})
it('HTTP guide permits the first save and suppresses duplicate saves',async()=>{
 function Profile(){return h('div')}
 Profile.initialState={name:'Troy',save:'idle'};Profile.model=model('http.md','Profile')
 t=renderComponent(Profile);await t.ready();t.simulateAction('SAVE');await t.settle()
 expect(t.requests('HTTP')).toHaveLength(1);expect(t.state.save).toBe('saving')
 t.simulateAction('SAVE');await t.settle();expect(t.requests('HTTP')).toHaveLength(1)
})
it('migration guide preserves loading admission across first, duplicate and completed requests',async()=>{
 function Worker(){return h('div')}
 Worker.initialState={status:'idle'};Worker.model=model('migrating-to-7.md','Worker')
 t=renderComponent(Worker);await t.ready();t.simulateAction('START');await t.settle()
 expect(t.state.status).toBe('working');expect(t.requests('HTTP')).toHaveLength(1)
 t.simulateAction('START');await t.settle()
 expect(t.state.status).toBe('working');expect(t.requests('HTTP')).toHaveLength(1)
 await t.respond('HTTP',{});await t.settle();expect(t.state.status).toBe('idle')
 t.simulateAction('START');await t.settle()
 expect(t.state.status).toBe('working');expect(t.requests('HTTP')).toHaveLength(2)
})
it.each([
 ['after',true,0],
 ['after',false,2],
 ['before',true,1],
])('loading-guard migration pitfall: timing=%s guarded=%s emits %s requests',async(sinkState,guarded,count)=>{
 function Worker(){return h('div')}
 Worker.initialState={status:'idle'}
 Worker.model={START:{
  STATE:s=>s.status!=='working'?{...s,status:'working'}:ABORT,
  HTTP:s=>!guarded||s.status!=='working'?{url:'/work',ok:'DONE'}:ABORT,
 },DONE:s=>({...s,status:'idle'})}
 t=renderComponent(Worker,{sinkState});await t.ready()
 t.simulateAction('START');await t.settle();t.simulateAction('START');await t.settle()
 expect(t.state.status).toBe('working');expect(t.requests('HTTP')).toHaveLength(count)
})
it('collection deletion guide emits the old ID after removing its item',async()=>{
 function TodoItem(){return h('button',{className:'remove'},'remove')}
 TodoItem.intent=({DOM})=>({DELETE:DOM.click('.remove')})
 TodoItem.model=model('collections.md','TodoItem',s=>s.includes('EVENTS'))
 function App(){return h('div',null,h(Collection,{of:TodoItem,from:'items'}))}
 App.initialState={items:[{id:7}]}
 t=renderComponent(App);await t.ready();t.simulateEvent('.remove','click');await t.settle()
 expect(t.state.items).toEqual([]);expect(t.emitted).toContainEqual({type:'TODO_DELETED',data:7})
})
