import {afterEach, describe, expect, it} from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {buildProject, checkFiles} from '../src/index.js'

let root
const write = (p, value) => {
  const file = path.join(root, p)
  fs.mkdirSync(path.dirname(file), {recursive:true})
  fs.writeFileSync(file, typeof value === 'object' ? JSON.stringify(value) : value)
  return file
}
const install = (dir, version) => write(path.join(dir, 'node_modules/sygnal/package.json'), {name:'sygnal', version, exports:{'.':'./not-built.js'}})
const source = `import {ABORT, run} from 'sygnal'
function App(){return <p/>}
App.model={START:{STATE:s=>({...s,status:'working'}),HTTP:s=>s.status!=='working'?{url:'/work'}:ABORT}}
run(App)`
const diagnostics = file => checkFiles([file], {cwd:root}).filter(d=>d.code==='SYG256')
afterEach(()=> { if(root) fs.rmSync(root,{recursive:true,force:true}); root=null })
const setup = () => { root=fs.mkdtempSync(path.join(os.tmpdir(),'sygnal-check-version-')) }

describe('installed Sygnal timing contract',()=>{
  it('uses the installed version, not the dependency range or checker version',()=>{
    setup()
    write('package.json',{name:'app',dependencies:{sygnal:'^7.0.0'}})
    install('', '6.6.0')
    const file=write('src/App.jsx',source)
    const project=buildProject([file],{cwd:root})
    expect(project.sygnalFor(file)).toMatchObject({version:'6.6.0',major:6,timing:'before'})
    expect(diagnostics(file)).toEqual([])
  })
  it('supports 7 prereleases and local workspace packages before building',()=>{
    setup()
    const pkg=write('packages/sygnal/package.json',{name:'sygnal',version:'7.0.0-beta.1+local'})
    fs.mkdirSync(path.join(root,'apps/app/node_modules'),{recursive:true})
    fs.symlinkSync(path.dirname(pkg),path.join(root,'apps/app/node_modules/sygnal'),'dir')
    const file=write('apps/app/src/App.jsx',source)
    expect(buildProject([file],{cwd:root}).sygnalFor(file)).toMatchObject({major:7,timing:'after'})
    const [d]=diagnostics(file)
    expect(d.message).toContain('installed 7.0.0-beta.1+local')
  })
  it('resolves each source package independently, including hoisted and nested installs',()=>{
    setup()
    install('','6.6.0')
    install('packages/new','7.0.0')
    const old=write('packages/old/src/App.jsx',source), current=write('packages/new/src/App.jsx',source)
    const project=buildProject([old,current],{cwd:path.join(root,'packages/new')})
    expect(project.sygnalFor(old).major).toBe(6)
    expect(project.sygnalFor(current).major).toBe(7)
    expect(checkFiles([old,current],{cwd:root}).filter(d=>d.code==='SYG256').map(d=>d.file)).toEqual(['packages/new/src/App.jsx'])
  })
  it('observes dependency updates on the next check even with unchanged source',()=>{
    setup(); install('','6.6.0')
    const file=write('src/App.jsx',source)
    expect(diagnostics(file)).toEqual([])
    install('','7.0.0')
    expect(diagnostics(file)).toHaveLength(1)
  })
  it('recognizes a local Sygnal source checkout',()=>{
    setup(); write('package.json',{name:'sygnal',version:'7.0.0'})
    const file=write('examples/App.jsx',source)
    expect(buildProject([file],{cwd:root}).sygnalFor(file).timing).toBe('after')
  })
  it('does not infer an installed version from a requested range or malformed manifest',()=>{
    setup(); write('package.json',{name:'app',dependencies:{sygnal:'^7'}})
    const file=write('src/App.jsx',source)
    expect(buildProject([file],{cwd:root}).sygnalFor(file).timing).toBeNull()
    expect(diagnostics(file)).toEqual([])
    install('','workspace:*')
    expect(buildProject([file],{cwd:root}).sygnalFor(file).major).toBeNull()
  })
  it('uses virtual manifests without reading the current disk for git-tree checks',()=>{
    const cwd='/virtual/project', file=cwd+'/src/App.jsx'
    const files=new Map([[file,source],[cwd+'/node_modules/sygnal/package.json',JSON.stringify({name:'sygnal',version:'6.6.0'})]])
    const project=buildProject([file],{cwd,tree:{read:p=>files.get(p)??null,isFile:p=>files.has(p)}})
    expect(project.sygnalFor(file)).toMatchObject({major:6,timing:'before'})
  })
})


describe('version-aware byId binding advice',()=>{
  const bindingSource = `import {byId} from 'sygnal'; function App({state}){return <Editor state={byId('projects',state.id)}/>} function Editor(){return <p/>}`
  const warnings = file => checkFiles([file],{cwd:root}).filter(d=>d.code==='SYG454')
  it.each(['7.0.0','7.0.0-beta.2'])('does not warn for known semantic rebinding on %s', version=>{
    setup(); install('',version)
    expect(warnings(write('src/App.jsx',bindingSource))).toEqual([])
  })
  it('retains legacy advice for installed 6',()=>{
    setup(); install('','6.6.0')
    const d=warnings(write('src/App.jsx',bindingSource))
    expect(d).toHaveLength(1)
    expect(d[0].message).toContain('retains its mount-time binding')
  })
  it('is silent when no installed version is available',()=>{
    setup()
    expect(warnings(write('src/App.jsx',bindingSource))).toEqual([])
  })
  it.each(['6.6.0','7.0.0'])('does not warn for explicit keys, changing keyed paths, or opaque lenses on %s', version=>{
    setup(); install('',version)
    const file=write('src/App.jsx',`import {byId} from 'sygnal'; function App({state}){return <div><Editor key={state.id} state={byId('projects',state.id)}/><Editor key={state.path} state={state.path}/><Editor state={{get:s=>s[state.id],set:(s,v)=>({...s,[state.id]:v})}}/></div>} function Editor(){return <p/>}`)
    expect(warnings(file)).toEqual([])
  })
})
