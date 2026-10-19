import {describe,it,expect} from 'vitest'
import {buildProject} from '../src/index.js'
import {sinkTiming,resolveStableValue,componentStaticKnown} from '../src/model/sinkTiming.js'

const root='/virtual/timing'
const component=`function App(){return <p/>} App.model={START:{STATE:s=>s,HTTP:s=>s}};`
function project(source,{version='7.0.0',files={}}={}) {
  const sources=new Map([[root+'/App.jsx',source],...Object.entries(files).map(([p,s])=>[root+'/'+p,s])])
  if(version) sources.set(root+'/node_modules/sygnal/package.json',JSON.stringify({name:'sygnal',version}))
  const tree={read:p=>sources.get(p)??null,isFile:p=>sources.has(p)}
  return buildProject([...sources.keys()].filter(p=>/\.[jt]sx?$/.test(p)),{cwd:root,sources,tree})
}
const timing=p=>sinkTiming(p,p.components.find(c=>c.name==='App').file)

describe('sink timing from the installed Sygnal',()=>{
  it.each(['7.0.0','7.0.0-beta.1','8.0.0'])('is after for every component on installed %s, with or without an entry',version=>{
    expect(timing(project(`import {run as boot} from 'sygnal'; ${component} boot(App)`,{version}))).toBe('after')
    expect(timing(project(component,{version}))).toBe('after')
  })
  it('is before on installed 6.x',()=>{
    expect(timing(project(component,{version:'6.6.0'}))).toBe('before')
  })
  it.each([null,'unknown'])('is unknown without an installed version (%s)',version=>{
    expect(timing(project(component,{version}))).toBeNull()
  })
  it('ignores a leftover sinkState declaration or option',()=>{
    expect(timing(project(`import {run} from 'sygnal'; ${component} App.sinkState='before';run(App,{}, {sinkState:'before'})`))).toBe('after')
  })
  it('resolves a nested package install for its own files',()=>{
    const p=project(`import {Child} from './lib/Child.jsx'`,{version:'6.6.0',files:{
      'lib/Child.jsx':`export function Child(){return <p/>};Child.model={GO:s=>s}`,
      'lib/node_modules/sygnal/package.json':JSON.stringify({name:'sygnal',version:'7.0.0'}),
    }})
    expect(sinkTiming(p,p.components.find(c=>c.name==='Child').file)).toBe('after')
  })
})


describe('stable constant object evidence',()=>{
  it.each([
    `let model={START:s=>s};App.model=model`,
    `const model={START:s=>s};const alias=model;alias.START=dynamic;App.model=model`,
    `const model={START:s=>s};Object.assign(model,dynamic);App.model=model`,
    `const model={START:s=>s};delete model.START;App.model=model`,
  ])('skips unstable model bindings: %s',declaration=>{
    const p=project(`function App(){return <p/>}${declaration}`)
    const c=p.components.find(c=>c.name==='App')
    expect(resolveStableValue(p,c.file,c.staticProps.model)).toBeNull()
  })
  it('resolves unchanged constant aliases and ignores unrelated mutations',()=>{
    const p=project(`function App(){return <p/>}const model={START:s=>s};const alias=model;const other={};other.START=dynamic;App.model=alias`)
    const c=p.components.find(c=>c.name==='App')
    expect(resolveStableValue(p,c.file,c.staticProps.model)?.node.type).toBe('ObjectExpression')
  })
})


describe('component static contract stability',()=>{
  const known=statements=>{
    const p=project(`function App(){return <p/>}App.model={START:{STATE:s=>s}};${statements}`)
    return componentStaticKnown(p,p.components.find(c=>c.name==='App'),'model')
  }
  it('accepts one unconditional model declaration and independent static fields',()=>{
    expect(known(`App.initialState={};App.intent=()=>({})`)).toBe(true)
  })
  it.each([
    `App.model.START.STATE=dynamic`, `App.model['START'].STATE=dynamic`,
    `const alias=App;alias.model.START=dynamic`, `delete App.model.START`,
    `Object.assign(App.model.START,{STATE:dynamic})`, `Object.assign(App,{model:dynamic})`,
    `App[key]=dynamic`, `App.model={OTHER:s=>s}`, `if(flag)App.model=dynamic`,
  ])('rejects apparent model mutation: %s',statements=>expect(known(statements)).toBe(false))
})
