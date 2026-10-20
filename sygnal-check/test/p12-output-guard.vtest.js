import {afterEach, describe, expect, it} from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import {spawnSync} from 'node:child_process'
import {fileURLToPath} from 'node:url'
import {checkFiles, fixFiles} from '../src/index.js'
import {startServer, tempDir, uriOf} from './lsp-helpers.js'

const state = `s => s.status !== 'working' ? {...s, status:'working'} : ABORT`
const output = `s => s.status !== 'working' ? {url:'/work',ok:'DONE'} : ABORT`
const app = (options = {}) => `import {ABORT,run,renderComponent,defineBehavior} from 'sygnal'
function App(){return <button className="start">Start</button>}
App.initialState={status:'idle'}
App.intent=({DOM})=>({START:DOM.click('.start')})
App.model=${options.model || `{START:{STATE:${options.state || state},HTTP:${options.output || output}},DONE:s=>({...s,status:'idle'})}`}
${options.extra || ''}
${options.entry === undefined ? 'run(App)' : options.entry}
`
function check(source, {version = '7.0.0', ...options} = {}) {
 const file='/virtual/app/App.tsx'
 const sources={[file]:source}
 if(version) sources['/virtual/app/node_modules/sygnal/package.json']=JSON.stringify({name:'sygnal',version})
 return checkFiles([file],{cwd:'/virtual/app',sources,...options})
}
const guards = (source, options) => {
 const d=check(source,options)
 expect(d.filter(x=>x.code==='SYG900')).toEqual([])
 return d.filter(x=>x.code==='SYG256')
}
function textAt(source, d) {
 const lines=source.split('\n')
 return lines.slice(d.line-1,d.endLine).map((s,i,a)=>s.slice(i===0?d.column-1:0,i===a.length-1?d.endColumn-1:undefined)).join('\n')
}

describe('provable after-state admission guards',()=>{
 it.each(['7.0.0','7.0.0-beta.1','8.0.0'])('reports the original case on installed %s',version=>{
  const source=app(), [d]=guards(source,{version})
  expect(d).toMatchObject({code:'SYG256',severity:'warn',component:'App',data:{action:'START',sink:'HTTP',fields:['status'],timing:'after',sygnal:version}})
  expect(textAt(source,d)).toBe("s.status !== 'working'")
  expect(textAt(source,d.related[0])).toBe("'working'")
  expect(d.related).toHaveLength(1)
  expect(d.message).toContain(`installed ${version}`)
  expect(d.fix).toContain('previousState');expect(d.fix).toContain('does not cancel other sinks')
  expect(d.fixes).toBeUndefined()
 })
 it.each([
  [`s=>({...s,loading:true})`,`s=>s.loading?ABORT:{url:'/work'}`,'loading'],
  [`s=>!s.loading?{...s,loading:true}:ABORT`,`s=>!s.loading?{url:'/work'}:ABORT`,'loading'],
  [`s=>({...s,loading:false})`,`s=>s.loading?{url:'/work'}:ABORT`,'loading'],
  [`s=>({...s,status:'working'})`,`s=>'working'===s.status?ABORT:{url:'/work'}`,'status'],
  [`s=>({...s,count:-1})`,`s=>s.count!==-1?{url:'/work'}:ABORT`,'count'],
  [`s=>({...s,token:null})`,`s=>s.token===null?ABORT:{url:'/work'}`,'token'],
  [`s=>{if(s.status==='working') return ABORT;return {...s,status:'working'}}`,`s=>{if(s.status==='working') return ABORT;return {url:'/work'}}`,'status'],
  [`s=>{if(!s.loading){return {...s,loading:true}}else{return ABORT}}`,`s=>{if(s.loading){return ABORT}else{return {url:'/work'}}}`,'loading'],
  [`(old: {status:string})=>({...old,status:'working' as const})`,`(current: {status:string})=>current.status!=='working'?{url:'/work'}:ABORT`,'status'],
 ])('recognizes bounded predicate/return forms %#',(state,output,field)=>{
  expect(guards(app({state,output}))[0]?.data.fields).toEqual([field])
 })
 it('handles shorthand entries and object methods',()=>{
  expect(guards(app({model:`{'START | STATE':${state},'START | HTTP':${output}}`}))).toHaveLength(1)
  expect(guards(app({model:`{START:{STATE(s){return {...s,status:'working'}},HTTP(s){if(s.status==='working')return ABORT;return {url:'/work'}}}}`}))).toHaveLength(1)
 })
 it('recognizes an aliased imported ABORT',()=>{
  expect(guards(app().replace('{ABORT,','{ABORT as STOP,').replaceAll(': ABORT',': STOP'))).toHaveLength(1)
 })
 it('recognizes ABORT imported from a sygnal subpath, not from another package',()=>{
  const sub=`import {ABORT} from 'sygnal/jsx'\n`+app().replace('{ABORT,','{')
  expect(guards(sub)).toHaveLength(1)
  expect(guards(`import {ABORT} from 'sygnalish'\n`+app().replace('{ABORT,','{'))).toEqual([])
 })
 it('resolves an unmodified constant model object',()=>{
  const source=app({model:'model'}).replace('App.model=model',`const model={START:{STATE:${state},HTTP:${output}}};App.model=model`)
  expect(guards(source)).toHaveLength(1)
 })
 it('warns once per affected output, across driver and core sinks',()=>{
  const model=`{START:{STATE:${state},HTTP:${output},PARENT:${output},EVENTS:${output}},DONE:s=>s}`
  expect(guards(app({model})).map(d=>d.data.sink)).toEqual(['HTTP','PARENT','EVENTS'])
 })
})
describe('version and effective snapshot exclusions',()=>{
 it.each(['6.6.0',null,'workspace:*'])('does not assume after for installed %s',version=>{
  expect(guards(app(),{version})).toEqual([])
 })
 it.each([
  {entry:''},
  {entry:`renderComponent(App)`},
  {extra:`App.sinkState='before'`},
  {entry:`run(App,{}, {sinkState:'before'})`},
 ])('reports every component on Sygnal 7, with any entry and ignoring a leftover sinkState %#',opts=>expect(guards(app(opts))).toHaveLength(1))
 it('reports a child component the same way as its root',()=>{
  const child=app({entry:''}).replaceAll('App','Child')
  expect(guards(child+`\nfunction Root(){return <Child/>};run(Root)`)[0]?.component).toBe('Child')
 })
})
describe('do not guess about writes, composition or intent',()=>{
 it.each([
  {output:`(s,data,next,{previousState})=>previousState.status!=='working'?{url:'/work'}:ABORT`},
  {output:`s=>s.status==='working'?{url:'/work'}:ABORT`},
  {output:`s=>s.other!=='working'?{url:'/work'}:ABORT`},
  {output:`s=>false?{url:'/work'}:ABORT`},
  {output:`s=>s.status!==s.status?{url:'/work'}:ABORT`},
  {output:`s=>s.status!=='working'?ABORT:ABORT`},
  {output:`s=>s.status==='working'?ABORT:(false?{url:'/work'}:ABORT)`},
  {output:`s=>s.status!=='working'?request(s):ABORT`},
  {output:`s=>{const ABORT={};return s.status!=='working'?{url:'/work'}:ABORT}`},
  {output:`(s,ABORT)=>s.status!=='working'?{url:'/work'}:ABORT`},
  {output:`s=>s.status!=='working'?{url:'/work'}:undefined`},
  {output:`s=>{s.status='idle';return s.status!=='working'?{url:'/work'}:ABORT}`},
  {output:`(s,data=mutate())=>s.status!=='working'?{url:'/work'}:ABORT`},
  {output:`(s,{[reset(s)]:v})=>s.status==='working'?ABORT:{url:'/work'}`},
  {state:`s=>({...s,status:nextStatus()})`},
  {state:`s=>({...s,status:'working',...patch})`},
  {state:`s=>({status:'working',...s})`},
  {state:`s=>({...s,[field]:'working'})`},
  {state:`s=>({...s,get status(){return 'working'}})`},
  {state:`s=>({...s,__proto__:null})`,output:`s=>s.__proto__===null?ABORT:{url:'/work'}`},
  {state:`s=>{next('OTHER');return {...s,status:'working'}}`},
  {state:`s=>false?{...s,status:'working'}:ABORT`},
  {state:`s=>{if(s.status==='working')return s;return {...s,status:'working'}}`},
  {state:`unknownReducer`},
  {model:`{START:{...sinks,STATE:${state},HTTP:${output}}}`},
  {model:`{...base,START:{STATE:${state},HTTP:${output}}}`},
  {model:`{START:{STATE:${state},STATE:s=>s,HTTP:${output}}}`},
  {model:`{START:{STATE:${state},HTTP:${output}},'START | STATE':s=>s}`},
  {model:`{START:{STATE:${state},HOST:s=>s,HTTP:${output}}}`},
  {extra:`App.uses=[defineBehavior({initialState:{},model:{}})]`},
  {extra:`App.calculated={status:()=> 'idle'}`},
  {extra:`App.model.START.STATE=s=>s`},
  {extra:`Object.assign(App.model.START,{STATE:s=>s})`},
  {extra:`const alias=App;alias.model.START.STATE=s=>s`},
  {extra:`delete App.model.START.STATE`},
 ])('remains silent for excluded or ambiguous case %#',opts=>expect(guards(app(opts))).toEqual([]))
 it('skips mutable model variables and mutations through model aliases',()=>{
  for(const declaration of [
   `let model={START:{STATE:${state},HTTP:${output}}}`,
   `const model={START:{STATE:${state},HTTP:${output}}};const alias=model;alias.START.STATE=s=>s`,
  ]){
   const source=app({model:'model'}).replace('App.model=model',declaration+';App.model=model')
   expect(guards(source)).toEqual([])
  }
 })
 it('respects inline suppression, ignore and no automatic rewrite',()=>{
  const source=app().replace('HTTP:', '// sygnal-ignore-next-line SYG256\nHTTP:')
  expect(guards(source)).toEqual([])
  expect(guards(app(),{ignore:['SYG256']})).toEqual([])
  const file='/virtual/app/App.tsx'
  const fixed=fixFiles([file],{cwd:'/virtual/app',sources:{[file]:app(),'/virtual/app/node_modules/sygnal/package.json':'{"name":"sygnal","version":"7.0.0"}'}})
  expect(fixed.files).toEqual([])
  expect(fixed.fixed).toBe(0)
 })
})

let dir,client
afterEach(()=>{client?.server.dispose();client=null;if(dir)fs.rmSync(dir,{recursive:true,force:true});dir=null})
it.each([false,true])('CLI and editor worker=%s expose the same warning and source range',async worker=>{
 dir=tempDir({'package.json':'{"name":"guard-fixture"}','node_modules/sygnal/package.json':'{"name":"sygnal","version":"7.0.0"}','src/App.tsx':app()})
 const file=path.join(dir,'src/App.tsx'), want=checkFiles([file],{cwd:dir}).find(d=>d.code==='SYG256')
 expect(want).toBeTruthy()
 const cli=spawnSync(process.execPath,[fileURLToPath(new URL('../bin/sygnal-check.js',import.meta.url)),'src','--json'],{cwd:dir,encoding:'utf8'})
 expect(cli.error).toBeUndefined()
 const cliFinding=JSON.parse(cli.stdout).find(d=>d.code==='SYG256')
 expect(cliFinding).toEqual(want)
 client=startServer({server:{worker}})
 await client.initialize({workspaceFolders:[{uri:uriOf(dir),name:'guard'}],initializationOptions:{paths:['src']}})
 const [d]=client.diagnostics.get(uriOf(file)).filter(d=>d.code==='SYG256')
 expect(d).toMatchObject({severity:2,range:{start:{line:want.line-1,character:want.column-1},end:{line:want.endLine-1,character:want.endColumn-1}}})
 expect(d.message).toContain(want.message)
 expect(d.relatedInformation).toHaveLength(1)
},20000)

describe('STATE path preconditions must establish a write-induced rejection',()=>{
 it.each([
  [`s=>s.status==='working'?{...s,status:'working',clicks:s.clicks+1}:ABORT`,output],
  [`s=>s.status!=='working'?ABORT:{...s,status:'working'}`,output],
  [`s=>{if(s.status==='working')return {...s,status:'working'};return ABORT}`,output],
  [`s=>{if(s.status!=='working')return ABORT;return {...s,status:'working'}}`,output],
  [`s=>s.loading?{...s,loading:true}:ABORT`,`s=>s.loading?ABORT:{url:'/work'}`],
  [`s=>!s.loading?ABORT:{...s,loading:true}`,`s=>!s.loading?{url:'/work'}:ABORT`],
  [`s=>{if(s.loading)return {...s,loading:true};return ABORT}`,`s=>s.loading?ABORT:{url:'/work'}`],
  [`s=>!s.loading?{...s,loading:false}:ABORT`,`s=>s.loading?{url:'/work'}:ABORT`],
  [`s=>s.loading===false?{...s,loading:false}:ABORT`,`s=>!s.loading?ABORT:{url:'/work'}`],
  [`s=>s.loading===true?{...s,loading:true}:ABORT`,`s=>s.loading?ABORT:{url:'/work'}`],
  [`s=>s.status==='idle'?ABORT:{...s,status:'working'}`,`s=>s.status==='idle'?{url:'/work'}:ABORT`],
  [`s=>s.status==='working'?(s.status==='idle'?{...s,status:'working'}:ABORT):ABORT`,output],
  [`s=>s.loading?(!s.loading?{...s,loading:true}:ABORT):ABORT`,`s=>s.loading?ABORT:{url:'/work'}`],
 ])('skips an already-rejected or infeasible old-state path %#',(state,output)=>{
  expect(guards(app({state,output}))).toEqual([])
 })
 it.each([
  [`s=>s.status==='idle'?{...s,status:'working'}:ABORT`,output],
  [`s=>{if(s.status!=='working')return {...s,status:'working'};return ABORT}`,output],
  [`s=>!s.loading?{...s,loading:true}:ABORT`,`s=>s.loading?ABORT:{url:'/work'}`],
  [`s=>s.loading?ABORT:{...s,loading:true}`,`s=>s.loading?ABORT:{url:'/work'}`],
  [`s=>s.other?{...s,status:'working'}:ABORT`,output],
 ])('retains the original changed-admission proof %#',(state,output)=>{
  expect(guards(app({state,output}))).toHaveLength(1)
 })
 it('still reports a changing transition beside an already rejected transition',()=>{
  const state=`s=>s.status==='working'?{...s,status:'working'}:{...s,status:'working'}`
  expect(guards(app({state}))).toHaveLength(1)
 })
})

