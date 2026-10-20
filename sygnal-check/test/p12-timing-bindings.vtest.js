import {it, expect} from 'vitest'
import {checkFiles} from '../src/index.js'
const check = (source, version = '6.6.0') => {
 const sources = {'/virtual/App.jsx':source}
 if (version) sources['/virtual/node_modules/sygnal/package.json'] = JSON.stringify({name:'sygnal', version})
 return checkFiles(['/virtual/App.jsx'], {cwd:'/virtual', sources}).filter(d=>d.code==='SYG454')
}
const dynamic = `import {byId as record} from 'sygnal'; function App({state}){return <Editor state={record('projects',state.selectedId)}/>} function Editor(){return <p/>}`
it('reports a dynamic unkeyed byId selection on an installed Sygnal 6',()=>{
 expect(check(dynamic).map(x=>x.code)).toEqual(['SYG454'])
})
it.each([null,'7.0.0','workspace:*'])('is silent when the installed Sygnal is %s',version=>{
 expect(check(dynamic,version)).toEqual([])
})
it('does not report constant IDs, explicit keys, spread keys or arbitrary lens allocations',()=>{
 expect(check(`import {byId} from 'sygnal'; function App({state}){return <div><Editor state={byId('projects',3)}/><Editor key={state.id} state={byId('projects',state.id)}/><Editor {...props} state={byId('projects',state.id)}/><Editor state={{get:s=>s.a,set:(s,v)=>({...s,a:v})}}/></div>} function Editor(){return <p/>}`)).toEqual([])
})
it('gives a leftover sinkState declaration no special treatment',()=>{
 const source=`import {run, defineBehavior} from 'sygnal';function App(){return <p/>};App.sinkState='later';defineBehavior({sinkState:true,initialState:{}});run(App,{}, {sinkState:'sometimes'})`
 for (const version of ['6.6.0','7.0.0',null]) {
  const sources={'/virtual/App.jsx':source}
  if (version) sources['/virtual/node_modules/sygnal/package.json']=JSON.stringify({name:'sygnal',version})
  expect(checkFiles(['/virtual/App.jsx'],{cwd:'/virtual',sources}).filter(d=>d.code==='SYG900' || /sinkState/.test(d.message))).toEqual([])
 }
})
