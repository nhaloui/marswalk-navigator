// Empty locally: Vite proxies /api. In production set the public API origin.
export function normalizeApiBase(value: string): string {
 const base=value.trim().replace(/\/+$/,'')
 if(!base)return ''
 const url=new URL(base)
 if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.search||url.hash||url.pathname!=='/')throw Error('VITE_API_BASE_URL must be an HTTP(S) origin, without /api or credentials.')
 return base
}
const base=normalizeApiBase(import.meta.env?.VITE_API_BASE_URL??'')
export const apiUrl=(path:string)=>`${base}/api${path}`

export function abortableDelay(ms:number,signal:AbortSignal):Promise<void>{
 return new Promise((resolve,reject)=>{
  const abort=()=>{clearTimeout(timer);reject(new DOMException('Aborted','AbortError'))}
  const timer=setTimeout(()=>{signal.removeEventListener('abort',abort);resolve()},ms)
  if(signal.aborted)abort();else signal.addEventListener('abort',abort,{once:true})
 })
}

// Retry only the idempotent health request, never a mission submission.
export async function waitForPlanner(signal:AbortSignal,onWaiting:()=>void){
 const until=Date.now()+120000
 let lastError:unknown
 while(Date.now()<until){
  signal.throwIfAborted()
  try{
   const response=await fetch(apiUrl('/health'),{signal:AbortSignal.any([signal,AbortSignal.timeout(8000)]),cache:'no-store',headers:{Accept:'application/json'}})
   if(response.ok&&(await response.json()).status==='ready')return
  }catch(error){lastError=error;signal.throwIfAborted()}
  onWaiting()
  await abortableDelay(2000,signal)
 }
 throw Error(lastError instanceof Error?'Planner could not wake up. Please try again shortly.':'Planner unavailable. Please try again shortly.')
}
