import {describe,it,expect} from 'vitest'
import {buildProject} from '../src/index.js'
import {sinkTimingContexts,resolveStableValue,componentStaticKnown} from '../src/model/sinkTiming.js'

const root='/virtual/timing'
const component=`function App(){return <p/>} App.model={START:{STATE:s=>s,HTTP:s=>s}};`
function project(source,{version='7.0.0',files={}}={}) {
  const sources=new Map([[root+'/App.jsx',source],...Object.entries(files).map(([p,s])=>[root+'/'+p,s])])
  if(version) sources.set(root+'/node_modules/sygnal/package.json',JSON.stringify({name:'sygnal',version}))
  const tree={read:p=>sources.get(p)??null,isFile:p=>sources.has(p)}
  return buildProject([...sources.keys()].filter(p=>/\.[jt]sx?$/.test(p)),{cwd:root,sources,tree})
}
const modes=(p,name='App')=>sinkTimingContexts(p,p.components.find(c=>c.name===name)).map(c=>c.mode)

describe('proven sink timing contexts',()=>{
  it.each(['7.0.0','7.0.0-beta.1','8.0.0'])('defaults an imported run entry to after on installed %s',version=>{
    const p=project(`import {run as boot} from 'sygnal'; ${component} boot(App)`,{version})
    expect(modes(p)).toEqual(['after'])
    const [context]=sinkTimingContexts(p,p.components[0])
    expect(context.via).toBe('run');expect(context.root.name).toBe('App');expect(context.node.type).toBe('CallExpression')
  })
  it.each(['6.6.0',null,'unknown'])('does not assume after on %s',version=>{
    expect(modes(project(`import {run} from 'sygnal'; ${component} App.sinkState='after';run(App)`,{version}))).toEqual([])
  })
  it('requires a context for a standalone inherited library component',()=>{
    expect(modes(project(component))).toEqual([])
  })
  it.each(['before','after'])('accepts an explicit %s component contract without an entry',mode=>{
    expect(modes(project(`${component} App.sinkState='${mode}'`))).toEqual([mode])
  })
  it('lets explicit component contracts override app contracts',()=>{
    expect(modes(project(`import {run} from 'sygnal'; ${component} App.sinkState='after';run(App,{}, {sinkState:'before'})`))).toEqual(['after'])
    expect(modes(project(`import {run} from 'sygnal'; ${component} App.sinkState='before';run(App)`))).toEqual(['before'])
  })
  it('does not treat a dynamic component mode as an absent override',()=>{
    expect(modes(project(`import {run} from 'sygnal'; ${component} App.sinkState=chooseMode();run(App)`))).toEqual([])
  })
  it('resolves imported helper objects, constant aliases, and ordered literal spreads',()=>{
    const p=project(`import {run} from 'sygnal';import {options} from './options.js';${component} const alias=options;run(App,{},alias)`,{files:{'options.js':`const base={sinkState:'before'};export const options={...base, sinkState:'after'}`}})
    expect(modes(p)).toEqual(['after'])
    expect(modes(project(`import {run} from 'sygnal';${component}run(App,{}, {...dynamic,sinkState:'before'})`))).toEqual(['before'])
  })
  it.each([
    `run(App,{}, dynamic)`, `run(App,{}, {sinkState:chooseMode()})`,
    `run(App,{}, {sinkState:'after',...dynamic})`, `run(App,{}, {[key]:true})`,
    `run(App,{}, {get sinkState(){return 'after'}})`, `run(...args)`,
    `let opts={sinkState:'after'};run(App,{},opts)`,
    `const opts={sinkState:'after'};opts.sinkState='before';run(App,{},opts)`,
  ])('skips unknown or mutable app options: %s',call=>{
    expect(modes(project(`import {run} from 'sygnal';${component}${call}`))).toEqual([])
  })
  it('recognizes renderComponent, defineElement, namespaces, and undefined/default options',()=>{
    expect(modes(project(`import {renderComponent as render} from 'sygnal';${component}render(App,{strict:true})`))).toEqual(['after'])
    expect(modes(project(`import {defineElement} from 'sygnal/element';${component}defineElement('my-app',App,{sinkState:'before'})`))).toEqual(['before'])
    expect(modes(project(`import * as Sygnal from 'sygnal';${component}Sygnal.run(App,{},undefined)`))).toEqual(['after'])
    expect(modes(project(`import {run} from 'sygnal';${component}App.sinkState=undefined;run(App,{}, {sinkState:undefined})`))).toEqual(['after'])
  })
  it('ignores unrelated or shadowed entry functions',()=>{
    expect(modes(project(`import {run} from 'other';${component}run(App)`))).toEqual([])
    expect(modes(project(`import {run} from 'sygnal';${component}function start(run){run(App)}`))).toEqual([])
  })
  it('uses actual child reachability and does not inherit a parent component declaration',()=>{
    const p=project(`import {run} from 'sygnal'; function Parent(){return <Child/>};Parent.sinkState='before';function Child(){return <p/>};Child.model={GO:s=>s};function Unused(){return <p/>};Unused.model={GO:s=>s};run(Parent)`)
    expect(modes(p,'Parent')).toEqual(['before'])
    expect(modes(p,'Child')).toEqual(['after'])
    expect(modes(p,'Unused')).toEqual([])
  })
  it('follows children across modules, Collection and Switchable usages',()=>{
    const p=project(`import {run} from 'sygnal';import Parent from './Parent.jsx';run(Parent,{}, {sinkState:'before'})`,{files:{
      'Parent.jsx':`import {Collection,Switchable} from 'sygnal';import {Child} from './Child.jsx';export default function Parent(){return <div><Collection of={Child} from="items"/><Switchable of={{one:Child}} current="one"/></div>}`,
      'Child.jsx':`export function Child(){return <p/>};Child.model={GO:s=>s}`,
    }})
    expect(modes(p,'Child')).toEqual(['before'])
  })
  it('keeps separate entry contexts when a component has both before and after consumers',()=>{
    const p=project(`import {run,renderComponent} from 'sygnal';${component}run(App,{}, {sinkState:'before'});renderComponent(App)`)
    const contexts=sinkTimingContexts(p,p.components.find(c=>c.name==='App'))
    expect(contexts.map(c=>[c.mode,c.via])).toEqual([['before','run'],['after','renderComponent']])
  })
  it('does not transfer a context from an entry installed on Sygnal 6 into a 7 component',()=>{
    const p=project(`import {run} from 'sygnal';import {Child} from './lib/Child.jsx';run(Child)`,{version:'6.6.0',files:{
      'lib/Child.jsx':`export function Child(){return <p/>};Child.model={GO:s=>s}`,
      'lib/node_modules/sygnal/package.json':JSON.stringify({name:'sygnal',version:'7.0.0'}),
    }})
    expect(modes(p,'Child')).toEqual([])
  })
  it.each([
    `const opts={sinkState:'after'};const alias=opts;alias.sinkState='before';run(App,{},opts)`,
    `const opts={sinkState:'before'};const alias=opts;delete alias.sinkState;run(App,{},opts)`,
    `const opts={sinkState:'after'};Object.assign(opts,{sinkState:'before'});run(App,{},opts)`,
    `const opts={};Object.defineProperty(opts,'sinkState',{value:'before'});run(App,{},opts)`,
    `let options={sinkState:'after'};const alias=options;run(App,{},alias)`,
    `let Root=App;run(Root)`,
    `let Root=App;const alias=Root;run(alias)`,
    `App=chooseComponent();run(App)`,
    `if(flag)App.sinkState='before';run(App)`,
    `App.sinkState='after';App.sinkState='before';run(App)`,
    `Object.assign(App,{sinkState:'before'});run(App)`,
    `delete App.sinkState;run(App)`,
  ])('does not prove timing through apparent mutation: %s',statements=>{
    expect(modes(project(`import {run} from 'sygnal';${component}${statements}`))).toEqual([])
  })
  it('does not let unrelated object mutations hide a proven context',()=>{
    expect(modes(project(`import {run} from 'sygnal';${component}const other={};Object.assign(other,{sinkState:'before'});run(App)`))).toEqual(['after'])
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
    expect(known(`App.sinkState='after';App.initialState={}`)).toBe(true)
  })
  it.each([
    `App.model.START.STATE=dynamic`, `App.model['START'].STATE=dynamic`,
    `const alias=App;alias.model.START=dynamic`, `delete App.model.START`,
    `Object.assign(App.model.START,{STATE:dynamic})`, `Object.assign(App,{model:dynamic})`,
    `App[key]=dynamic`, `App.model={OTHER:s=>s}`, `if(flag)App.model=dynamic`,
  ])('rejects apparent model mutation: %s',statements=>expect(known(statements)).toBe(false))
})


describe('accessor options do not establish a timing contract',()=>{
  it.each([
    `const options={get diagnostics(){this.sinkState='before';return 'off'},sinkState:'after'};run(App,{},options)`,
    `const base={get diagnostics(){this.sinkState='before';return 'off'}};run(App,{}, {...base,sinkState:'after'})`,
    `run(App,{}, {sinkState:'after',get diagnostics(){this.sinkState='before';return 'off'}})`,
    `run(App,{}, {sinkState:'after',set diagnostics(value){this.sinkState='before'}})`,
  ])('skips direct or spread accessors: %s',statements=>{
    expect(modes(project(`import {run} from 'sygnal';${component}${statements}`))).toEqual([])
  })
})

describe('prototype options remain opaque',()=>{
  it.each([
    `const options={__proto__:{get diagnostics(){this.sinkState='before';return 'off'}},sinkState:'after'};run(App,{},options)`,
    `const base={__proto__:{get diagnostics(){this.sinkState='before';return 'off'}}};run(App,{}, {...base,sinkState:'after'})`,
    `run(App,{}, {__proto__:null,sinkState:'after'})`,
    `run(App,{}, {'__proto__':unknownPrototype,sinkState:'after'})`,
  ])('does not infer timing from a noncomputed prototype: %s',statements=>{
    expect(modes(project(`import {run} from 'sygnal';${component}${statements}`))).toEqual([])
  })
  it('keeps an explicitly computed __proto__ data property distinct from prototype syntax',()=>{
    expect(modes(project(`import {run} from 'sygnal';${component}run(App,{}, {['__proto__']:null,sinkState:'after'})`))).toEqual(['after'])
  })
})
