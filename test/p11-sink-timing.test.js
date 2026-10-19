// @vitest-environment jsdom
// Sygnal 7.0's one timing contract: in every model entry STATE runs first (whatever the key
// order) and runs once; every other sink gets the committed state, props.previousState the state
// from before the action. There is no option. Behaviors follow it (their outputs get the updated
// slice; old values come from props.previousState). Plus the review fixes that landed with it.
import {it,expect,vi,afterEach} from 'vitest'
import {mount,h,api,ABORT,microtasks} from './parity/harness.js'
import {renderComponent} from '../src/extra/testing.js'
import {Collection} from '../src/collection.js'
import {setupChecks,diagnostics} from './diagnostics/helpers.js'
import {_resetDiagnostics} from '../src/extra/diagnostics/index.js'
import {configureTimingAudit} from '../src/extra/diagnostics/checks/index.js'
const flush=async m=>{await m.app.__runtime.flushed();await microtasks()}
const dispatch=(m,t,d)=>m.app.__runtime.dispatch('root',t,d)
let t
afterEach(()=>{t?.dispose();t=null;configureTimingAudit(undefined);_resetDiagnostics()})

it('STATE runs first and once, whatever the key order; outputs get the committed state and previousState',async()=>{
 const seen=[];let calls=0
 function C(){return h('p',null,'x')};C.initialState={n:0}
 C.model={GO:{EFFECT:(s,d,n,p)=>seen.push(['effect',s.n,p.state.n,p.previousState.n]),STATE:s=>(calls++,{...s,n:s.n+1}),LOG:(s,d,n,p)=>(seen.push(['log',s.n,p.previousState.n]),'x')}}
 const m=mount(C,{LOG:s$=>{s$.addListener({next:()=>{}})}});await flush(m);dispatch(m,'GO');await flush(m)
 expect(calls).toBe(1);expect(seen).toEqual([['effect',1,1,0],['log',1,0]])
})

it('a STATE reducer gets the old state as state and previousState',async()=>{
 const seen=[]
 function C(){return h('p',null,'x')};C.initialState={n:3}
 C.model={GO:{STATE:(s,d,n,p)=>(seen.push([s.n,p.state.n,p.previousState.n]),{...s,n:4})}}
 const m=mount(C);await flush(m);dispatch(m,'GO');await flush(m);expect(seen).toEqual([[3,3,3]])
})

for(const kind of ['abort','same','throw','no-state'])it(`${kind}: unchanged state still produces output, with state === previousState`,async()=>{
 const seen=[];const spy=vi.spyOn(console,'error').mockImplementation(()=>{})
 try {
 function C(){return h('p',null,'x')};C.initialState={n:2}
 C.model={GO:{...(kind!=='no-state'&&{STATE:s=>{if(kind==='throw')throw Error('expected');return kind==='abort'?ABORT:s}}),EFFECT:(s,d,n,p)=>seen.push([s.n,s===p.previousState])}}
 const m=mount(C);await flush(m);dispatch(m,'GO');await flush(m);expect(seen).toEqual([[2,true]]);expect(m.state().n).toBe(2)
 }finally{spy.mockRestore()}
})

it('a sinkState static no longer exists: it changes nothing',async()=>{
 const seen=[]
 function C(){return h('p',null,'x')};C.initialState={n:0};C.sinkState='before'
 C.model={GO:{STATE:s=>({...s,n:1}),EFFECT:s=>seen.push(s.n)}}
 const m=mount(C);await flush(m);dispatch(m,'GO');await flush(m);expect(seen).toEqual([1])
})

it('a behavior output gets its updated slice; the old slice is previousState[key]',async()=>{
 const seen=[]
 const b=api.defineBehavior({initialState:{n:0},model:{GO:{STATE:s=>({...s,n:s.n+1}),EFFECT:(s,d,n,p,o,k)=>seen.push([s.n,p.state[k].n,p.previousState[k].n])}}})
 function C(){return h('p',null,'x')};C.initialState={};C.uses={b:b()}
 const m=mount(C);await flush(m);dispatch(m,'b.GO');await flush(m);expect(seen).toEqual([[1,1,0]])
})

it('STATE, HOST and host STATE compose once before outputs',async()=>{
 const steps=[]
 const b=api.defineBehavior({initialState:{n:0},model:{GO:{STATE:s=>(steps.push('slice'),{...s,n:1}),HOST:s=>(steps.push('whole'),{...s,total:s.b.n}),EFFECT:(s,d,n,p)=>steps.push([s.n,p.state.total])}}})
 function C(){return h('p',null,'x')};C.initialState={};C.uses={b:b()};C.model={'b.GO':{STATE:s=>(steps.push('host'),{...s,total:s.total+10})}}
 const m=mount(C);await flush(m);dispatch(m,'b.GO');await flush(m)
 expect(steps).toEqual(['slice','whole','host',[1,11]])
})

it('a behavior EFFECT and a host EFFECT share the disposal AbortSignal and one exception boundary',async()=>{
 const signals=[];const seen=[];const spy=vi.spyOn(console,'error').mockImplementation(()=>{})
 try {
 const b=api.defineBehavior({initialState:{n:0},model:{GO:{STATE:s=>({...s,n:1}),EFFECT:(s,d,n,p)=>{signals.push(p.signal)}},BAD:{EFFECT:()=>{throw Error('expected')}}}})
 function C(){return h('p',null,'x')};C.initialState={};C.uses={b:b()};C.model={'b.GO':{EFFECT:(s,d,n,p)=>{signals.push(p.signal)}},'b.BAD':{EFFECT:()=>seen.push('host')}}
 const m=mount(C);await flush(m);dispatch(m,'b.GO');dispatch(m,'b.BAD');await flush(m)
 expect(signals).toHaveLength(2);expect(signals[0]).toBe(signals[1]);expect(signals[0].aborted).toBe(false);expect(seen).toEqual([])
 m.app.dispose();expect(signals[0].aborted).toBe(true)
 }finally{spy.mockRestore()}
})

it('a synchronous driver reply queues after the action and sees its committed state',async()=>{
 const seen=[];const replies=api.xs.create()
 const driver=s$=>{s$.addListener({next:()=>replies.shamefullySendNext({type:'REPLY',data:null})});return {__sygnalReplies:true,replies:()=>replies}}
 function C(){return h('p',null,'x')};C.initialState={n:0};C.model={GO:{STATE:s=>({...s,n:1}),SPY:s=>(seen.push(['send',s.n]),{})},REPLY:{EFFECT:s=>seen.push(['reply',s.n])}}
 const m=mount(C,{SPY:driver});await flush(m);dispatch(m,'GO');await flush(m);expect(seen).toEqual([['send',1],['reply',1]])
})

// ---- self-removal: the outputs get the last state, however the component is mounted -------

function Item({state}){return h('li',null,h('button',{className:'rm'},state?.name??''))}
Item.intent=({DOM})=>({REMOVE:DOM.click('.rm')})
Item.model={REMOVE:{STATE:()=>undefined,PARENT:s=>({removed:s.name})}}
for(const how of ['collection','state="sel"'])it(`a component that removes its own state (${how}): its outputs get its last state`,async()=>{
 function List({state}){return h('ul',null,how==='collection'?h(Collection,{of:Item,from:'items'}):h(Item,{state:'sel'}),h('p',null,String(state.got.length)))}
 List.initialState={items:[{id:1,name:'a'}],sel:{name:'a'},got:[]}
 List.intent=({CHILD})=>({GOT:CHILD.select(Item)})
 List.model={GOT:(s,v)=>({...s,got:[...s.got,v]})}
 const spy=vi.spyOn(console,'error').mockImplementation(()=>{})
 try {
  t=renderComponent(List);await t.ready();t.simulateEvent('.rm','click');await t.settle()
  expect(t.state.got).toEqual([{removed:'a'}]);expect(spy).not.toHaveBeenCalled()
 }finally{spy.mockRestore()}
})

// ---- a child that fails to instantiate is not retried on every owner render ----------------

it('a failed child with a string binding is attempted again only when its target changes',async()=>{
 let attempts=0
 function Bad(){return h('div',null,'bad')}
 Bad.intent=()=>{attempts++;throw Error('expected')}
 Bad.model={X:s=>s}
 function P({state}){return h('div',null,h('span',null,String(state.n)),h(Bad,{state:state.key}))}
 P.initialState={n:0,key:'a',a:{},b:{}}
 P.model={INC:s=>({...s,n:s.n+1}),SWITCH:s=>({...s,key:'b'})}
 const spy=vi.spyOn(console,'error').mockImplementation(()=>{})
 try {
  t=renderComponent(P);await t.ready()
  for(let i=0;i<5;i++){t.simulateAction('INC');await t.settle()}
  expect(attempts).toBe(1)
  t.simulateAction('SWITCH');await t.settle()
  expect(attempts).toBe(2)
 }finally{spy.mockRestore()}
})

// ---- the timing audit (SYG257, opt-in, dev entry) -------------------------------------------

function Counter({state}){return h('button',{className:'inc'},String(state.n))}
Counter.intent=({DOM})=>({INC:DOM.click('.inc')})
Counter.model={INC:{STATE:s=>({...s,n:s.n+1}),PARENT:s=>s.n+1,EFFECT:s=>{void s.label}}}
function Host({state}){return h('div',null,h(Counter,{state:'c'}),h('p',null,String(state.got)))}
Host.initialState={c:{n:0,label:'x'},got:null}
Host.intent=({CHILD})=>({GOT:CHILD.select(Counter)})
Host.model={GOT:(s,v)=>({...s,got:v})}

it('timing audit: a read of a field the same action changed is reported once; an unchanged read is not',async()=>{
 setupChecks()
 t=renderComponent(Host,{timingAudit:true});await t.ready()
 t.simulateEvent('.inc','click');await t.settle();t.simulateEvent('.inc','click');await t.settle()
 const d=diagnostics('SYG257')
 expect(d).toHaveLength(1)
 expect(d[0]).toMatchObject({severity:'info',data:{action:'INC',sink:'PARENT',field:'n'}})
 expect(d[0].fix).toMatch(/props\.previousState\.n/)
})

it('timing audit: off by default; configureTimingAudit(true) turns it on',async()=>{
 setupChecks()
 t=renderComponent(Host);await t.ready();t.simulateEvent('.inc','click');await t.settle()
 expect(diagnostics('SYG257')).toEqual([])
 t.dispose();t=null;setupChecks();configureTimingAudit(true)
 t=renderComponent(Host);await t.ready();t.simulateEvent('.inc','click');await t.settle()
 expect(diagnostics('SYG257')).toHaveLength(1)
})
