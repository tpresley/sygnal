// @vitest-environment jsdom
import {afterEach, expect, it} from 'vitest'
import {renderComponent, createElement as h} from '../src/index.js'

let t
afterEach(() => {t?.dispose();t=undefined})
function Counter({state}) {return h('button', {className:'inc'}, String(state.n))}
Counter.initialState={n:0}
Counter.intent=({DOM})=>({INC:DOM.click('.inc'),LATER:DOM.click('.later')})
Counter.model={INC:s=>({...s,n:s.n+1}),LATER:s=>s}

for(const dom of ['mock','real']) for(const wait of ['next','waitForState'])
it(`${wait} names the pending simulated input count (${dom} DOM)`,async()=>{
 t=renderComponent(Counter,{dom,eventWaitMs:1000});await t.ready()
 // The unresolved selector holds both inputs; the state wait expires before selector readiness.
 t.simulateEvent('.later','click',{allowMissing:true});t.simulateAction('INC')
 await expect(t[wait](s=>s.n===1,30)).rejects.toThrow(`${wait} timed out after 30ms. 2 simulated input(s) still pending.`)
 expect(t.state.n).toBe(0)
})

for(const wait of ['next','waitForState']) it(`${wait} identifies a real DOM burst that has not finished delivery`,async()=>{
 t=renderComponent(Counter,{dom:'real'});await t.ready()
 for(let i=0;i<40;i++) t.simulateEvent('.inc','click')
 let failure
 try {await t[wait](s=>s.n===40,35)} catch(error) {failure=error}
 expect(failure).toBeInstanceOf(Error)
 const count=Number(failure.message.match(/(\d+) simulated input\(s\) still pending/)?.[1])
 expect(count).toBeGreaterThan(0)
 expect(count).toBe(40-t.state.n)
})

for(const wait of ['next','waitForState']) it(`${wait} omits an input backlog when none is queued`,async()=>{
 t=renderComponent(Counter);await t.ready()
 let failure
 try {await t[wait](s=>s.n===1,20)} catch(error) {failure=error}
 expect(failure.message).toContain(`${wait} timed out after 20ms.`)
 expect(failure.message).not.toContain('simulated input')
})
