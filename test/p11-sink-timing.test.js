// @vitest-environment jsdom
import {it,expect,vi} from 'vitest'
import {mount,h,click,until,api,ABORT,microtasks} from './parity/harness.js'
const flush=async m=>{await m.app.__runtime.flushed();await microtasks()}
const dispatch=(m,t,d)=>m.app.__runtime.dispatch('root',t,d)

for(const appMode of [undefined,'before','after']) for(const componentMode of [undefined,'before','after'])
it(`app=${appMode??'default'}, component=${componentMode??'inherit'}: snapshot and one STATE call`,async()=>{
 const out=[];let calls=0
 function C({state}){return h('p',null,state.n)}
 C.initialState={n:0};C.sinkState=componentMode
 C.calculated={double:s=>s.n*2}
 C.model={GO:{EFFECT:(s,d,n,p)=>out.push([s.n,s.double,p.state.n,p.previousState.n]),STATE:s=>(calls++,{...s,n:s.n+1}),SPY:s=>s.n}}
 const m=mount(C,{SPY:s$=>{s$.addListener({next:v=>out.push(v)});return {}}},{sinkState:appMode})
 await flush(m);dispatch(m,'GO');await flush(m)
 const after=(componentMode??appMode??'after')==='after'
 expect(out).toEqual([[after?1:0,after?2:0,after?1:0,0],after?1:0]);expect(calls).toBe(1)
})

for(const behaviorMode of ['before','after']) for(const hostMode of ['before','after'])
it(`behavior=${behaviorMode}, host=${hostMode}: grouped EFFECT keeps provenance and order`,async()=>{
 const out=[];let stateCalls=0
 const behavior=api.defineBehavior({sinkState:behaviorMode,initialState:{n:0},model:{GO:{
  STATE:s=>(stateCalls++,{...s,n:s.n+1}),
  EFFECT:(s,d,n,p)=>out.push(['behavior',s.n,p.state.b.n,p.previousState.b.n])
 }}})
 function C(){return h('p',null,'x')};C.initialState={};C.sinkState=hostMode;C.uses={b:behavior()}
 C.model={'b.GO':{STATE:s=>({...s,b:{...s.b,n:s.b.n+10}}),EFFECT:(s,d,n,p)=>out.push(['host',s.b.n,p.state.b.n,p.previousState.b.n])}}
 const m=mount(C);await flush(m);dispatch(m,'b.GO');await flush(m)
 expect(out).toEqual([['behavior',behaviorMode==='after'?11:0,behaviorMode==='after'?11:0,0],['host',hostMode==='after'?11:0,hostMode==='after'?11:0,0]])
 expect(stateCalls).toBe(1);expect(m.state().b.n).toBe(11)
})

it('value sink host override wins and uses host timing',async()=>{
 const seen=[]
 const b=api.defineBehavior({sinkState:'before',initialState:{n:0},model:{GO:{STATE:s=>({...s,n:1}),SPY:()=>99}}})
 function C(){return h('p',null,'x')};C.sinkState='after';C.initialState={};C.uses={b:b()};C.model={'b.GO':{SPY:s=>s.b.n}}
 const m=mount(C,{SPY:s$=>{s$.addListener({next:v=>seen.push(v)});return {}}});await flush(m);dispatch(m,'b.GO');await flush(m)
 expect(seen).toEqual([1])
})

it('STATE, HOST and host STATE compose once before outputs',async()=>{
 const steps=[]
 const b=api.defineBehavior({sinkState:'after',initialState:{n:0},model:{GO:{STATE:s=>(steps.push('slice'),{...s,n:1}),HOST:s=>(steps.push('whole'),{...s,total:s.b.n}),EFFECT:(s,d,n,p)=>steps.push([s.n,p.state.total])}}})
 function C(){return h('p',null,'x')};C.initialState={};C.uses={b:b()};C.model={'b.GO':{STATE:s=>(steps.push('host'),{...s,total:s.total+10})}}
 const m=mount(C);await flush(m);dispatch(m,'b.GO');await flush(m)
 expect(steps).toEqual(['slice','whole','host',[1,11]])
})

for(const kind of ['abort','same','throw','no-state'])it(`${kind}: unchanged state still produces output`,async()=>{
 const seen=[];const spy=vi.spyOn(console,'error').mockImplementation(()=>{})
 try {
 function C(){return h('p',null,'x')};C.sinkState='after';C.initialState={n:2}
 C.model={GO:{...(kind!=='no-state'&&{STATE:s=>{if(kind==='throw')throw Error('expected');return kind==='abort'?ABORT:s}}),EFFECT:s=>seen.push(s.n)}}
 const m=mount(C);await flush(m);dispatch(m,'GO');await flush(m);expect(seen).toEqual([2]);expect(m.state().n).toBe(2)
 }finally{spy.mockRestore()}
})

it('context and props.previousState correspond to before/after frames',async()=>{
 const seen=[]
 function C(){return h('p',null,'x')};C.sinkState='after';C.initialState={n:1};C.context={n:s=>s.n}
 C.model={GO:{STATE:s=>({...s,n:2}),EFFECT:(s,d,n,p)=>seen.push([s.n,p.context.n,p.previousState.n])}}
 const m=mount(C);await flush(m);dispatch(m,'GO');await flush(m);expect(seen).toEqual([[2,2,1]])
})

it('same function shared across apps does not leak app defaults',async()=>{
 const seen=[]
 function C(){return h('p',null,'x')};C.initialState={n:0};C.model={GO:{STATE:s=>({...s,n:1}),EFFECT:s=>seen.push(s.n)}}
 const a=mount(C,{}, {sinkState:'before'}),b=mount(C,{}, {sinkState:'after'});await flush(a);await flush(b)
 dispatch(a,'GO');dispatch(b,'GO');await flush(a);await flush(b);expect(seen).toEqual([0,1])
})

it('synchronous driver reply queues after the action with its committed state',async()=>{
 const seen=[];const replies=api.xs.create()
 const driver=s$=>{s$.addListener({next:()=>replies.shamefullySendNext({type:'REPLY',data:null})});return {__sygnalReplies:true,replies:()=>replies}}
 function C(){return h('p',null,'x')};C.sinkState='after';C.initialState={n:0};C.model={GO:{STATE:s=>({...s,n:1}),SPY:s=>(seen.push(['send',s.n]),{})},REPLY:{EFFECT:s=>seen.push(['reply',s.n])}}
 const m=mount(C,{SPY:driver});await flush(m);dispatch(m,'GO');await flush(m);expect(seen).toEqual([['send',1],['reply',1]])
})

it('mixed actions use STATE first even when a before EFFECT originally preceded it',async()=>{
 let enabled=false;const seen=[]
 const b=api.defineBehavior({sinkState:'before',initialState:{n:0},model:{GO:{EFFECT:s=>{enabled=true;seen.push(['effect',s.n])},STATE:s=>({...s,n:enabled?1:-1})}}})
 function C(){return h('p',null,'x')};C.sinkState='after';C.initialState={};C.uses={b:b()};C.model={'b.GO':{SPY:s=>s.b.n}}
 const m=mount(C,{SPY:s$=>{s$.addListener({next:()=>{}});return {}}});await flush(m);dispatch(m,'b.GO');await flush(m)
 expect(seen).toEqual([['effect',0]]);expect(m.state().b.n).toBe(-1)
})

it('merged EFFECT preserves exception skip behavior',async()=>{
 const seen=[];const spy=vi.spyOn(console,'error').mockImplementation(()=>{})
 try{
 const b=api.defineBehavior({sinkState:'after',initialState:{n:0},model:{GO:{EFFECT:()=>{throw Error('expected')},STATE:s=>({...s,n:1})}}})
 function C(){return h('p',null,'x')};C.sinkState='before';C.initialState={};C.uses={b:b()};C.model={'b.GO':{EFFECT:()=>seen.push('host')}}
 const m=mount(C);await flush(m);dispatch(m,'b.GO');await flush(m);expect(seen).toEqual([])
 }finally{spy.mockRestore()}
})

it('mixed behavior/host EFFECT frames retain the disposal AbortSignal',async()=>{
 const signals=[]
 const b=api.defineBehavior({sinkState:'before',initialState:{n:0},model:{GO:{STATE:s=>({...s,n:1}),EFFECT:(s,d,n,p)=>{signals.push(p.signal)}}}})
 function C(){return h('p',null,'x')};C.sinkState='after';C.initialState={};C.uses={b:b()};C.model={'b.GO':{EFFECT:(s,d,n,p)=>{signals.push(p.signal)}}}
 const m=mount(C);await flush(m);dispatch(m,'b.GO');await flush(m)
 expect(signals).toHaveLength(2);expect(signals[0]).toBe(signals[1]);expect(signals[0].aborted).toBe(false)
 m.app.dispose();expect(signals[0].aborted).toBe(true)
})

it('renderComponent matches an app after default without a component declaration', async () => {
 function C(){return h('p',null,'x')}
 C.initialState={n:0}; C.model={GO:{STATE:s=>({...s,n:s.n+1}),SPY:s=>s.n}}
 const t=api.renderComponent(C);await t.ready()
 try {t.simulateAction('GO');await t.settle();expect(t.sinkValues('SPY')).toEqual([1])} finally {t.dispose()}
})

it('rejects invalid app, component and behavior timing', () => {
 const spy=vi.spyOn(console,'error').mockImplementation(()=>{})
 try {
  function C(){return h('p',null,'x')} C.initialState={n:0}
  expect(()=>api.run(C,{}, {sinkState:'later',useDefaultDrivers:false})).toThrow(/SYG255/)
  expect(()=>api.defineBehavior({sinkState:true,initialState:{}})()).toThrow(/SYG255/)
  C.sinkState='later'
  expect(()=>api.run(C,{}, {useDefaultDrivers:false})).toThrow(/SYG255/)
 } finally {spy.mockRestore()}
})

it('parent timing does not cascade to a child with its own inherited app default',async()=>{
 const seen=[]
 function Child(){return h('p',null,'x')}
 Child.model={GO:{STATE:s=>({...s,n:1}),EFFECT:s=>{seen.push(s.n)}}}
 function Parent(){return h(Child)}
 Parent.sinkState='before';Parent.initialState={n:0}
 const m=mount(Parent,{}, {sinkState:'after'});await flush(m)
 m.app.__runtime.dispatch(m.app.__runtime.root.children()[0],'GO');await flush(m)
 expect(seen).toEqual([1])
})

it('a changed explicit declaration is respected on HMR',async()=>{
 const seen=[]
 function C(){return h('p',null,'x')};C.initialState={n:0};C.sinkState='before';C.model={GO:{STATE:s=>({...s,n:s.n+1}),EFFECT:s=>{seen.push(s.n)}}}
 const m=mount(C,{}, {sinkState:'after'});await flush(m);dispatch(m,'GO')
 function Next(){return h('p',null,'x')};Next.sinkState='after';Next.model=C.model
 m.app.hmr(Next);await flush(m);dispatch(m,'GO');await flush(m)
 expect(seen).toEqual([0,2])
})

it('persist preserves a before behavior PERSIST predicate beside an after host effect',async()=>{
 const seen=[], storage={getItem:()=>null,setItem:()=>{},removeItem:()=>{seen.push('clear')}}
 const b=api.defineBehavior({sinkState:'before',initialState:{n:0},model:{GO:{STATE:s=>({...s,n:1}),PERSIST:s=>({clear:s.n===0})}}})
 function C(){return h('p',null,'x')};C.initialState={};C.sinkState='after';C.uses={b:b()}
 C.persist=api.persist({key:'test',storage});C.model={'b.GO':{EFFECT:s=>{seen.push(s.b.n)}}}
 const m=mount(C);await flush(m);dispatch(m,'b.GO');await flush(m)
 expect(seen).toEqual([1,'clear'])
})

for (const behaviorMode of ['before', 'after']) it(`mixed ${behaviorMode} behavior keeps the runtime signal over a component signal prop`, async () => {
 const seen=[], external=new AbortController().signal
 const behavior=api.defineBehavior({sinkState:behaviorMode,initialState:{n:0},model:{GO:{
  STATE:s=>({...s,n:1}),
  EFFECT:(s,_d,_n,p)=>{seen.push(['behavior',s.n,p.state.b.n,p.previousState.b.n,p.signal])},
 }}})
 function Child(){return h('p',null,'child')}
 Child.sinkState=behaviorMode==='before'?'after':'before';Child.uses={b:behavior()}
 Child.model={'b.GO':{EFFECT:(s,_d,_n,p)=>{seen.push(['host',s.b.n,p.state.b.n,p.previousState.b.n,p.signal])}}}
 function App(){return h(Child,{signal:external})} App.initialState={}
 const m=mount(App);await flush(m)
 m.app.__runtime.dispatch(m.app.__runtime.root.children()[0],'b.GO');await flush(m)
 const b=behaviorMode==='before'?0:1,hv=1-b
 expect(seen.map(x=>x.slice(0,4))).toEqual([['behavior',b,b,0],['host',hv,hv,0]])
 expect(seen[0][4]).toBe(seen[1][4]);expect(seen[0][4]).not.toBe(external)
 expect(seen[0][4].aborted).toBe(false)
 m.app.dispose();expect(seen[0][4].aborted).toBe(true);expect(external.aborted).toBe(false)
})
