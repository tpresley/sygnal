import {it, expect} from 'vitest'
import {checkFiles} from '../src/index.js'
const check = source => checkFiles(['/virtual/App.jsx'], {cwd:'/virtual', sources:{'/virtual/App.jsx':source}}).filter(d=>['SYG255','SYG454'].includes(d.code))
it('validates literal component, behavior and run snapshot contracts',()=>{
 const d=check(`import {run, defineBehavior} from 'sygnal'; function App(){return <p/>} App.sinkState='later'; const b=defineBehavior({sinkState:true,initialState:{}});run(App,{}, {sinkState:'sometimes'})`)
 expect(d.filter(x=>x.code==='SYG255')).toHaveLength(3)
})
it('accepts modes, aliases, and unknown dynamic options without guessing',()=>{
 expect(check(`import {run as boot, defineBehavior} from 'sygnal'; function App(){return <p/>} App.sinkState='before';boot(App,{}, {sinkState:'after'});defineBehavior({sinkState:unknownMode, initialState:{}})`)).toEqual([])
})
it('reports a dynamic unkeyed byId selection',()=>{
 const d=check(`import {byId as record} from 'sygnal'; function App({state}){return <Editor state={record('projects',state.selectedId)}/>} function Editor(){return <p/>}`)
 expect(d.map(x=>x.code)).toEqual(['SYG454'])
})
it('does not report constant IDs, explicit keys, spread keys or arbitrary lens allocations',()=>{
 expect(check(`import {byId} from 'sygnal'; function App({state}){return <div><Editor state={byId('projects',3)}/><Editor key={state.id} state={byId('projects',state.id)}/><Editor {...props} state={byId('projects',state.id)}/><Editor state={{get:s=>s.a,set:(s,v)=>({...s,a:v})}}/></div>} function Editor(){return <p/>}`)).toEqual([])
})

it('does not crash while validating options with spreads',()=>{
 const source=`import {run} from 'sygnal';function App(){return <p/>};const base={};run(App,{}, {...base,sinkState:'after'})`
 expect(checkFiles(['/virtual/App.jsx'],{cwd:'/virtual',sources:{'/virtual/App.jsx':source}}).filter(d=>['SYG900','SYG255'].includes(d.code))).toEqual([])
})
