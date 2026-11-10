// @vitest-environment jsdom
// SYG265 / SYG266 at run time (src/extra/diagnostics/checks/effects.ts): a view or a non-EFFECT
// handler that really makes the call, whichever way it was written. Static rule: sygnal-check.
import {it,expect,vi,afterEach,beforeEach} from 'vitest'
import {h} from './parity/harness.js'
import {renderComponent} from '../src/extra/testing.js'
import {setupChecks,diagnostics} from './diagnostics/helpers.js'
import {_resetDiagnostics} from '../src/extra/diagnostics/index.js'
let t, realFetch
beforeEach(()=>{realFetch=globalThis.fetch;globalThis.fetch=vi.fn(()=>Promise.resolve({ok:true}));navigator.sendBeacon=vi.fn(()=>true);setupChecks()})
afterEach(()=>{t?.dispose();t=null;globalThis.fetch=realFetch;delete navigator.sendBeacon;_resetDiagnostics()})

const app=(view,model={},extra={})=>{
 function App(p){view?.(p);return h('button',{className:'go'},'go')}
 App.initialState={n:0};App.intent=({DOM})=>({GO:DOM.click('.go')});App.model={GO:s=>s,...model};Object.assign(App,extra)
 return App
}
const start=async(C)=>{t=renderComponent(C);await t.ready();return t}
const click=async()=>{t.simulateEvent('.go','click');await t.settle()}

it('a call in a view, spelled so the static rule cannot read it',async()=>{
 const k=['fe','tch'].join('')
 await start(app(()=>{globalThis[k]('/x')}))
 const d=diagnostics('SYG265')
 expect(d).toHaveLength(1)
 expect(d[0].message).toContain('the view of App called fetch')
 expect(d[0]).toMatchObject({severity:'warn',data:{place:'the view',api:'fetch'}})
 expect(globalThis.fetch).toHaveBeenCalledWith('/x') // it still runs
})

it('sendBeacon, storage, a timer and a cookie in a reducer; once each',async()=>{
 await start(app(null,{GO:{STATE:s=>{navigator.sendBeacon('/x');localStorage.setItem('a','1');setTimeout(()=>{},1);document.cookie='a=1';return {...s,n:s.n+1}}}}))
 await click();await click()
 expect(diagnostics('SYG265').map(d=>d.data.api)).toEqual(['navigator.sendBeacon'])
 expect(diagnostics('SYG266').map(d=>d.data.api).sort()).toEqual(['Storage.setItem','document.cookie','setTimeout'])
 expect(diagnostics('SYG265')[0].message).toContain("the STATE reducer for 'GO'")
})

it('another sink handler counts; a constructor still constructs',async()=>{
 let made
 const send=vi.fn()
 globalThis.WebSocket=class{constructor(u){this.u=u}}
 const C=app(null,{GO:{MSG:s=>{made=new WebSocket('wss://x');return 1}}})
 t=renderComponent(C,{drivers:{MSG:()=>send}});await t.ready();await click()
 expect(diagnostics('SYG265')[0].message).toContain("the MSG handler of 'GO'")
 expect(made.u).toBe('wss://x')
 delete globalThis.WebSocket
})

it('EFFECT is the declared place; next() is the framework',async()=>{
 await start(app(null,{GO:{EFFECT:(s,d,next)=>{fetch('/x');localStorage.setItem('a','1');setTimeout(()=>{},1)},STATE:(s,d,next)=>{next('DONE');return s}},DONE:s=>({...s,n:1})}))
 await click()
 expect(diagnostics('SYG265')).toEqual([])
 expect(diagnostics('SYG266')).toEqual([])
})

it('nothing stays patched, and later calls are not reported',async()=>{
 const before=globalThis.setTimeout, f=globalThis.fetch
 await start(app(null,{GO:{STATE:s=>{queueMicrotask(()=>fetch('/late'));return s}}}))
 await click();await Promise.resolve()
 expect(globalThis.setTimeout).toBe(before)
 expect(globalThis.fetch).toBe(f)
 expect(diagnostics('SYG265')).toEqual([]) // a continuation is out of reach: research README
})

it('a view that throws restores the globals',async()=>{
 const f=globalThis.fetch
 await start(app(()=>{throw new Error('boom')},{},{onError:()=>h('p',null,'e')}))
 expect(globalThis.fetch).toBe(f)
})
