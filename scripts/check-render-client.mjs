import assert from 'node:assert/strict'
import {normalizeApiBase,apiUrl,waitForPlanner,abortableDelay} from '../src/planner/api.ts'

assert.equal(normalizeApiBase(' https://odos-api.onrender.com/ '),'https://odos-api.onrender.com')
assert.equal(apiUrl('/missions'),' /api/missions'.trim())
for(const bad of ['ftp://example.com','https://example.com/api','https://u:p@example.com','https://example.com?key=x'])assert.throws(()=>normalizeApiBase(bad))

const originalFetch=globalThis.fetch,originalTimeout=globalThis.setTimeout
let calls=0,waiting=0
try{
 // Simulate Render waking up: HTML/503 and network errors before JSON health.
 globalThis.setTimeout=(fn,ms,...args)=>originalTimeout(fn,ms===2000?1:ms,...args)
 globalThis.fetch=async()=>{
  calls++
  if(calls===1)return new Response('<html>Starting</html>',{status:503})
  if(calls===2)throw new TypeError('Service waking up')
  return Response.json({status:'ready'})
 }
 await waitForPlanner(new AbortController().signal,()=>waiting++)
 assert.equal(calls,3);assert.equal(waiting,2)
 const cancelled=new AbortController();cancelled.abort()
 await assert.rejects(waitForPlanner(cancelled.signal,()=>{}),{name:'AbortError'})
 const delay=new AbortController(),pending=abortableDelay(10000,delay.signal);delay.abort()
 await assert.rejects(pending,{name:'AbortError'})
}finally{globalThis.fetch=originalFetch;globalThis.setTimeout=originalTimeout}
console.log('PASS: API origin validation, local fallback, cold-start retries and cancellation.')
